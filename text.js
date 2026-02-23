const { CONFIG, logger, MemoryManager } = require('../config/scraperConfig');
const { 
  RateLimiter, 
  AWSProxyManager, 
  PythonProcessPool, 
  UserSessionManager,
  validateWebsite,
  findSitemap,
  processSitemap,
  scrapeWebpage
} = require('../helper/scraperCore');
const { 
  RedisQueueManager,
  SystemMonitor,
  processAllSitemapsAndWebpages,
  gracefulShutdown,
  handleProxyRotateRequest
} = require('../helper/scraperInfrastructure');


class ScraperService {
  constructor() {
    this.initialized = false;
    this.components = {};
  }

  /**
   * Initialize all components
   */
  async initialize() {
    if (this.initialized) {
      logger.warn("Scraper service already initialized");
      return;
    }

    logger.info("🚀 Initializing Scraper Service...");

    try {
      // Initialize core components
      this.components.rateLimiter = new RateLimiter();
      this.components.sessionManager = new UserSessionManager();
      this.components.awsProxyManager = new AWSProxyManager(CONFIG.AWS_PROXY.MAX_CONCURRENT_REQUESTS);
      this.components.pythonProcessPool = new PythonProcessPool(CONFIG.PYTHON.MAX_CONCURRENT_PROCESSES);
      
      // Initialize infrastructure (optional)
      this.components.redisQueueManager = new RedisQueueManager();
      await this.components.redisQueueManager.initialize();
      
      this.components.systemMonitor = new SystemMonitor();

      // Start periodic cleanup tasks
      this._startPeriodicTasks();

      // Setup graceful shutdown
      this._setupGracefulShutdown();

      this.initialized = true;
      logger.info("✅ Scraper Service initialized successfully");
      
    } catch (error) {
      logger.error("❌ Failed to initialize Scraper Service", error);
      throw error;
    }
  }

  /**
   * Main website processing function
   */
  async processWebsite(sitemapUrls, userId, websiteUrl, options = {}) {
    this._ensureInitialized();
    
    return processAllSitemapsAndWebpages(
      sitemapUrls,
      userId,
      websiteUrl,
      options,
      this.components
    );
  }

  /**
   * Validate website and find sitemaps
   */
  async validateWebsite(websiteUrl, userId = null) {
    this._ensureInitialized();
    return validateWebsite(websiteUrl, userId, this.components.rateLimiter);
  }

  /**
   * Handle proxy rotate requests (for AWS proxy server)
   */
  async handleProxyRequest(req, res) {
    this._ensureInitialized();
    return handleProxyRotateRequest(
      req, 
      res, 
      this.components.pythonProcessPool, 
      this.components.rateLimiter
    );
  }

  /**
   * Get system health
   */
  async getSystemHealth() {
    this._ensureInitialized();
    return this.components.systemMonitor.getSystemHealth(this.components);
  }

  /**
   * Reset blocked domains
   */
  resetBlockedDomains(domainList = null) {
    this._ensureInitialized();
    
    if (domainList && Array.isArray(domainList)) {
      domainList.forEach((domain) => {
        this.components.rateLimiter.resetDomain(domain);
      });
      return `Reset domains: ${domainList.join(", ")}`;
    } else {
      const count = this.components.rateLimiter.resetAllBlockedDomains();
      return `Reset ${count} blocked domains`;
    }
  }

  /**
   * Get all component statistics
   */
  getAllStats() {
    this._ensureInitialized();

    return {
      memory: MemoryManager.getMemoryStats(),
      sessions: this.components.sessionManager.getGlobalStats(),
      awsProxy: this.components.awsProxyManager.getStats(),
      pythonProcesses: this.components.pythonProcessPool.getStats(),
      redis: this.components.redisQueueManager.getConnectionStatus(),
      rateLimiter: {
        totalDomains: this.components.rateLimiter.domainQueues.size,
        blockedDomains: Array.from(this.components.rateLimiter.domainQueues.keys())
          .filter(domain => this.components.rateLimiter.isDomainBlocked(domain)).length,
      },
    };
  }


  async shutdown() {
    if (!this.initialized) return;
    
    logger.info("Shutting down Scraper Service...");
    await gracefulShutdown(this.components);
  }

  /**
   * Start periodic cleanup tasks
   */
  _startPeriodicTasks() {
    // Rate limiter cleanup every 10 minutes
    setInterval(() => {
      this.components.rateLimiter.cleanup();
    }, 10 * 60 * 1000);

    // Session cleanup every 10 minutes
    setInterval(() => {
      this.components.sessionManager.cleanupStaleSessions();
    }, 10 * 60 * 1000);

    // Reset blocked domains on startup after 5 seconds
    setTimeout(() => {
      const resetCount = this.components.rateLimiter.resetAllBlockedDomains();
      if (resetCount > 0) {
        logger.info(`Startup: Reset ${resetCount} previously blocked domains`);
      }
    }, 5000);
  }

  /**
   * Setup graceful shutdown handlers
   */
  _setupGracefulShutdown() {
    const shutdownHandler = () => this.shutdown();
    
    process.on("SIGTERM", shutdownHandler);
    process.on("SIGINT", shutdownHandler);
    
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", error);
      this.shutdown();
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled promise rejection", reason);
      this.shutdown();
    });
  }

  /**
   * Ensure service is initialized
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error("Scraper service not initialized. Call initialize() first.");
    }
  }
}

// Create singleton instance
const scraperService = new ScraperService();

// ================================
// BACKWARD COMPATIBILITY FUNCTIONS
// ================================

/**
 * Backward compatible function exports
 * These maintain compatibility with the original large file
 */

// Initialize the service automatically for backward compatibility
let autoInitialized = false;

async function ensureInitialized() {
  if (!autoInitialized) {
    await scraperService.initialize();
    autoInitialized = true;
  }
}

// Export backward compatible functions
async function validateWebsiteCompat(websiteUrl, userId = null) {
  await ensureInitialized();
  return scraperService.validateWebsite(websiteUrl, userId);
}

async function processAllSitemapsAndWebpagesCompat(sitemapUrls, userId, websiteUrl, options = {}) {
  await ensureInitialized();
  return scraperService.processWebsite(sitemapUrls, userId, websiteUrl, options);
}

async function getSystemHealthCompat() {
  await ensureInitialized();
  return scraperService.getSystemHealth();
}

function resetBlockedDomainsCompat(domainList = null) {
  if (!autoInitialized) {
    throw new Error("Service not initialized. Call any async function first or initialize manually.");
  }
  return scraperService.resetBlockedDomains(domainList);
}

async function handleProxyRotateRequestCompat(req, res) {
  await ensureInitialized();
  return scraperService.handleProxyRequest(req, res);
}

async function gracefulShutdownCompat() {
  if (autoInitialized) {
    await scraperService.shutdown();
  }
}

module.exports = {
  // Main service instance (new approach)
  scraperService,
  
  // Individual components (for direct access)
  CONFIG,
  logger,
  MemoryManager,
  RateLimiter,
  AWSProxyManager,
  PythonProcessPool,
  UserSessionManager,
  RedisQueueManager,
  SystemMonitor,
  
  // Core functions
  validateWebsite,
  findSitemap,
  processSitemap,
  scrapeWebpage,
  processAllSitemapsAndWebpages,
  gracefulShutdown,
  handleProxyRotateRequest,
  
  // Backward compatibility functions (maintain original API)
  validateWebsite: validateWebsiteCompat,
  processAllSitemapsAndWebpages: processAllSitemapsAndWebpagesCompat,
  getSystemHealth: getSystemHealthCompat,
  resetBlockedDomains: resetBlockedDomainsCompat,
  handleProxyRotateRequest: handleProxyRotateRequestCompat,
  gracefulShutdown: gracefulShutdownCompat,
  

};




