const config = require('../config/scraper');
const logger = require('../config/logger');

class RateLimiter {
  constructor() {
    this.domains = new Map();
    this.globalLastRequest = 0;
    this.blockedDomains = new Map();
  }

  async waitForDomain(domain) {
    const now = Date.now();
    
    // Check if domain is blocked
    if (this.isBlocked(domain)) {
      const blockedUntil = this.blockedDomains.get(domain);
      const waitTime = blockedUntil - now;
      if (waitTime > 0) {
        throw new Error(`Domain ${domain} is blocked for ${Math.round(waitTime / 1000)}s`);
      } else {
        this.unblockDomain(domain);
      }
    }

    // Initialize domain data if not exists
    if (!this.domains.has(domain)) {
      this.domains.set(domain, {
        lastRequest: 0,
        totalRequests: 0,
        successfulRequests: 0,
        consecutiveErrors: 0,
        averageResponseTime: 1000,
        rateLimitHits: 0,
        lastErrorTime: 0
      });
    }

    const domainData = this.domains.get(domain);
    const delay = this.calculateDelay(domain, domainData);

    // Global rate limiting
    const globalDelay = Math.max(0, config.rate_limits.base_delay - (now - this.globalLastRequest));
    
    // Domain-specific rate limiting
    const domainDelay = Math.max(0, delay - (now - domainData.lastRequest));
    
    const totalDelay = Math.max(globalDelay, domainDelay);

    if (totalDelay > 0) {
      await this.sleep(totalDelay);
    }

    // Update timestamps
    domainData.lastRequest = Date.now();
    domainData.totalRequests++;
    this.globalLastRequest = Date.now();
  }

  calculateDelay(domain, data) {
    let delay = config.rate_limits.base_delay;
    
    // Adjust based on success rate
    if (data.totalRequests > 5) {
      const successRate = data.successfulRequests / data.totalRequests;
      if (successRate < 0.5) {
        delay *= 3; // Poor success rate = much slower
      } else if (successRate < 0.8) {
        delay *= 1.5; // Moderate success rate = slower
      } else if (successRate > 0.95) {
        delay *= 0.7; // Excellent success rate = faster
      }
    }

    // Adjust for consecutive errors
    if (data.consecutiveErrors > 0) {
      delay *= Math.pow(config.rate_limits.error_multiplier, Math.min(data.consecutiveErrors, 5));
    }

    // Adjust for response time
    if (data.averageResponseTime > 5000) {
      delay *= 1.8; // Slow server = slower requests
    } else if (data.averageResponseTime < 1000) {
      delay *= 0.6; // Fast server = faster requests
    }

    // Recent rate limiting
    if (data.rateLimitHits > 0 && (Date.now() - data.lastErrorTime) < 120000) {
      delay *= 4; // Recent rate limit = much slower
    }

    // Add some randomness to avoid thundering herd
    delay *= (0.8 + Math.random() * 0.4);

    return Math.min(delay, config.rate_limits.max_delay);
  }

  recordSuccess(domain, responseTime) {
    const data = this.domains.get(domain);
    if (!data) return;

    data.successfulRequests++;
    data.consecutiveErrors = Math.max(0, data.consecutiveErrors - 1);
    
    // Update average response time (exponential moving average)
    data.averageResponseTime = data.averageResponseTime * 0.8 + responseTime * 0.2;
  }

  recordError(domain, errorType) {
    const data = this.domains.get(domain);
    if (!data) return;

    data.consecutiveErrors++;
    data.lastErrorTime = Date.now();

    // Different handling for different error types
    if (errorType === 'ECONNREFUSED' || errorType === 'ENOTFOUND') {
      // Server/DNS issues - block temporarily
      this.blockDomain(domain, 30000); // 30 seconds
    } else if (errorType.includes('429')) {
      // Rate limited - block longer
      data.rateLimitHits++;
      this.blockDomain(domain, 120000); // 2 minutes
    } else if (errorType.includes('403')) {
      // Forbidden - might be bot detection
      this.blockDomain(domain, 60000); // 1 minute
    }

    // Block domain if too many consecutive errors
    if (data.consecutiveErrors >= 8) {
      const blockTime = Math.min(300000, data.consecutiveErrors * 15000); // Max 5 minutes
      this.blockDomain(domain, blockTime);
      logger.warn(`Blocking domain ${domain} for ${blockTime/1000}s due to ${data.consecutiveErrors} consecutive errors`);
    }
  }

  blockDomain(domain, duration) {
    const blockedUntil = Date.now() + duration;
    this.blockedDomains.set(domain, blockedUntil);
  }

  unblockDomain(domain) {
    this.blockedDomains.delete(domain);
    const data = this.domains.get(domain);
    if (data) {
      data.consecutiveErrors = Math.max(0, data.consecutiveErrors * 0.5);
      data.rateLimitHits = Math.max(0, data.rateLimitHits - 1);
    }
  }

  isBlocked(domain) {
    if (!this.blockedDomains.has(domain)) return false;
    
    const blockedUntil = this.blockedDomains.get(domain);
    if (Date.now() >= blockedUntil) {
      this.unblockDomain(domain);
      return false;
    }
    return true;
  }

  resetDomain(domain) {
    this.domains.delete(domain);
    this.blockedDomains.delete(domain);
    logger.info(`Reset rate limiting for domain: ${domain}`);
  }

  resetAllBlocked() {
    const count = this.blockedDomains.size;
    this.blockedDomains.clear();
    
    // Also reset error counts for all domains
    for (const [domain, data] of this.domains.entries()) {
      data.consecutiveErrors = 0;
      data.rateLimitHits = 0;
    }
    
    logger.info(`Reset ${count} blocked domains`);
    return count;
  }

  cleanup() {
    const cutoff = Date.now() - 1800000; // 30 minutes
    
    for (const [domain, data] of this.domains.entries()) {
      if (data.lastRequest < cutoff) {
        this.domains.delete(domain);
      }
    }

    // Check blocked domains
    for (const [domain, blockedUntil] of this.blockedDomains.entries()) {
      if (Date.now() >= blockedUntil) {
        this.unblockDomain(domain);
      }
    }
  }

  getStats() {
    const totalDomains = this.domains.size;
    const blockedCount = this.blockedDomains.size;
    
    let totalRequests = 0;
    let totalSuccessful = 0;
    let domainsWithErrors = 0;

    for (const [domain, data] of this.domains.entries()) {
      totalRequests += data.totalRequests;
      totalSuccessful += data.successfulRequests;
      if (data.consecutiveErrors > 0) domainsWithErrors++;
    }

    return {
      total_domains: totalDomains,
      blocked_domains: blockedCount,
      domains_with_errors: domainsWithErrors,
      total_requests: totalRequests,
      success_rate: totalRequests > 0 ? (totalSuccessful / totalRequests * 100).toFixed(1) + '%' : '0%',
      global_last_request: this.globalLastRequest
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RateLimiter;