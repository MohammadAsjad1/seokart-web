const axios = require('axios');
const config = require('../config/scraper');

class HttpClient {
  constructor() {
    this.sessionPool = new Map();
    this.globalStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      avgResponseTime: 0
    };
  }

  createSession(domain) {
    const session = axios.create({
      timeout: config.timeouts.standard_request,
      maxRedirects: 5,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'no-cache',
        'DNT': '1'
      },
      validateStatus: (status) => status < 500 // Don't throw on client errors
    });

    // Request interceptor for user agent rotation and stats
    session.interceptors.request.use((config) => {
      config.headers['User-Agent'] = this.getRandomUserAgent();
      config.metadata = { startTime: Date.now() };
      return config;
    });

    // Response interceptor for stats collection
    session.interceptors.response.use(
      (response) => {
        this.updateStats(response, true);
        return response;
      },
      (error) => {
        this.updateStats(error.response, false);
        return Promise.reject(error);
      }
    );

    return session;
  }

  getSession(domain) {
    if (!this.sessionPool.has(domain)) {
      this.sessionPool.set(domain, this.createSession(domain));
    }
    return this.sessionPool.get(domain);
  }

  getRandomUserAgent() {
    return config.user_agents[Math.floor(Math.random() * config.user_agents.length)];
  }

  async get(url, options = {}) {
    const domain = this.extractDomain(url);
    const session = this.getSession(domain);
    
    return session.get(url, {
      ...options,
      timeout: options.timeout || config.timeouts.standard_request
    });
  }

  async head(url, options = {}) {
    const domain = this.extractDomain(url);
    const session = this.getSession(domain);
    
    return session.head(url, {
      ...options,
      timeout: options.timeout || config.timeouts.quick_request
    });
  }

  async post(url, data, options = {}) {
    const domain = this.extractDomain(url);
    const session = this.getSession(domain);
    
    return session.post(url, data, {
      ...options,
      timeout: options.timeout || config.timeouts.standard_request
    });
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return 'unknown';
    }
  }

  updateStats(response, success) {
    this.globalStats.totalRequests++;
    
    if (success) {
      this.globalStats.successfulRequests++;
    } else {
      this.globalStats.failedRequests++;
    }

    // Calculate response time if available
    if (response && response.config && response.config.metadata) {
      const responseTime = Date.now() - response.config.metadata.startTime;
      this.globalStats.totalResponseTime += responseTime;
      this.globalStats.avgResponseTime = this.globalStats.totalResponseTime / this.globalStats.totalRequests;
    }
  }

  getStats() {
    return {
      ...this.globalStats,
      activeSessions: this.sessionPool.size,
      successRate: this.globalStats.totalRequests > 0 ? 
        (this.globalStats.successfulRequests / this.globalStats.totalRequests * 100).toFixed(2) + '%' : '0%'
    };
  }

  cleanup() {
    this.sessionPool.clear();
  }
}

// Create singleton instance
const httpClient = new HttpClient();

module.exports = httpClient;