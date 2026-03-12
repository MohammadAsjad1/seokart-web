const crypto = require("crypto");
const JobManager = require("../jobs/job-manager");
const SessionManager = require("../core/session-manager");
const WebScraper = require("../core/scraper");
const SitemapService = require("./sitemap-service");
const ActivityService = require("./activity-service");
const config = require("../config/scraper");
const logger = require("../config/logger");
const axios = require("axios");
const urlUtils = require("../utils/url-utils");
const { WebpageCore } = require("../models/webpage-models");
const crashRecoveryService = require("./crash-recovery-service");
const scrapeQueue = require("../queue/scrapeQueue");
const crawlV2Phase1Queue = require("../queue/crawlV2Phase1Queue");

class ScraperService {
  constructor() {
    this.jobManager = new JobManager();
    this.sessionManager = new SessionManager();
    this.sitemapService = new SitemapService();
    this.activityService = new ActivityService();
    this.webScraper = new WebScraper();

    this.initialized = false;
    this.healthCheckInterval = null;
    this.cleanupInterval = null;
  }

  async initialize() {
    if (this.initialized) {
      logger.warn("Scraper service already initialized");
      return;
    }

    logger.info("🚀 Initializing Node.js Scraper Service...");

    try {
      await this.initializeDatabase();

      // ADD - CRASH RECOVERY ON STARTUP
      logger.info("🔄 Running crash recovery...");
      const crashRecovery = await crashRecoveryService.recoverFromCrash();
      logger.info(
        `✅ Crash recovery complete: ${crashRecovery.failed} activities recovered`
      );

      // ADD - START STALLED JOB MONITOR
      crashRecoveryService.startStalledJobMonitor();

      this.startPeriodicTasks();
      this.setupShutdownHandlers();

      this.initialized = true;
      logger.info("✅ Scraper Service initialized successfully");
    } catch (error) {
      logger.error("❌ Failed to initialize Scraper Service", error);
      throw error;
    }
  }

  async initializeDatabase() {
    logger.info("Database connections initialized");
  }

  async validateWebsite(websiteUrl, userId = null, rateLimiter = null) {
    try {
      if (!urlUtils.isValidUrl(websiteUrl)) {
        return {
          isValid: false,
          message:
            "Invalid URL format. URL must start with 'http://' or 'https://'",
        };
      }

      const isSitemapUrl = this.detectIfSitemapUrl(websiteUrl);

      if (isSitemapUrl) {
        return await this.validateSitemapUrl(websiteUrl, userId, rateLimiter);
      } else {
        return await this.validateWebsiteUrl(websiteUrl, userId, rateLimiter);
      }
    } catch (error) {
      logger.error("Error validating website", error, userId);
      return {
        isValid: false,
        message: "Error validating website: " + error.message,
      };
    }
  }

  detectIfSitemapUrl(url) {
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes("sitemap") ||
      lowerUrl.endsWith(".xml") ||
      lowerUrl.includes("xmlsitemap.php") ||
      lowerUrl.includes("sitemap_index")
    );
  }

  extractBaseWebsiteUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    } catch (error) {
      return url;
    }
  }

  async validateSitemapUrl(sitemapUrl, userId = null, rateLimiter = null) {
    try {
      const parsedUrl = new URL(sitemapUrl);
      const baseWebsiteUrl = this.extractBaseWebsiteUrl(sitemapUrl);

      if (rateLimiter) {
        await rateLimiter.acquire(parsedUrl.hostname);
      }

      const response = await axios.get(sitemapUrl, {
        timeout: 10000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/xml, text/xml, */*",
        },
        validateStatus: (status) => status < 500,
        maxRedirects: 5,
      });

      if (response.status !== 200) {
        if (rateLimiter) {
          rateLimiter.reportError(parsedUrl.hostname, "sitemap");
        }
        return {
          isValid: false,
          message: `Sitemap URL returned status ${response.status}`,
        };
      }

      const contentType = response.headers["content-type"] || "";
      const content = response.data.toString();

      const isValidXML =
        contentType.includes("xml") ||
        content.trim().startsWith("<?xml") ||
        content.includes("<urlset") ||
        content.includes("<sitemapindex");

      if (!isValidXML) {
        if (rateLimiter) {
          rateLimiter.reportError(parsedUrl.hostname, "sitemap");
        }
        return {
          isValid: false,
          message: "Provided URL does not contain valid XML sitemap content",
        };
      }

      if (rateLimiter) {
        rateLimiter.reportSuccess(parsedUrl.hostname);
      }

      return {
        isValid: true,
        inputType: "sitemap",
        sitemapUrls: [sitemapUrl],
        websiteUrl: baseWebsiteUrl,
        message: "Valid sitemap URL provided",
      };
    } catch (error) {
      logger.error("Error validating sitemap URL", error, userId);
      return {
        isValid: false,
        message: "Could not access sitemap URL: " + error.message,
      };
    }
  }

  async validateWebsiteUrl(websiteUrl, userId = null, rateLimiter = null) {
    try {
      const domain = urlUtils.extractDomain(websiteUrl);
      if (!domain) {
        return { isValid: false, message: "Invalid URL structure" };
      }

      if (rateLimiter && rateLimiter.isDomainBlocked(domain)) {
        return {
          isValid: false,
          message: `Domain ${domain} is temporarily blocked. Please try again later.`,
        };
      }

      if (rateLimiter) {
        await rateLimiter.acquire(domain);
      }

      try {
        await axios.head(websiteUrl, {
          timeout: 8000,
          maxRedirects: 3,
          validateStatus: (status) => status < 500,
        });

        if (rateLimiter) {
          rateLimiter.reportSuccess(domain);
        }
      } catch (error) {
        if (rateLimiter) {
          rateLimiter.reportError(domain, "validation");
        }
        return {
          isValid: false,
          message: "Website is not accessible",
        };
      }

      const sitemapResult = await this.findSitemap(
        websiteUrl,
        userId,
        rateLimiter
      );

      if (sitemapResult.error) {
        logger.warn(
          `No sitemaps found for ${websiteUrl}: ${sitemapResult.error}`,
          userId
        );

        return {
          isValid: true,
          inputType: "website",
          noSitemaps: true,
          message: "Website is accessible but has no XML sitemaps",
          suggestion: "Please provide a sitemap URL manually if available",
          websiteUrl: this.extractBaseWebsiteUrl(websiteUrl),
        };
      }

      if (Array.isArray(sitemapResult) && sitemapResult.length === 0) {
        return {
          isValid: true,
          inputType: "website",
          noSitemaps: true,
          message: "Website is accessible but has no valid XML sitemaps",
          suggestion: "Please provide a sitemap URL manually if available",
          websiteUrl: this.extractBaseWebsiteUrl(websiteUrl),
        };
      }

      return {
        isValid: true,
        inputType: "website",
        sitemapUrls: sitemapResult,
        message: `Found ${sitemapResult.length} sitemap(s)`,
        websiteUrl: this.extractBaseWebsiteUrl(websiteUrl),
      };
    } catch (error) {
      logger.error("Error validating website URL", error, userId);
      return {
        isValid: false,
        message: "Error validating website: " + error.message,
      };
    }
  }

  async findIncompleteWebpages(userActivityId) {
    try {
      const incompletePages = await WebpageCore.find({
        userActivityId,
        $or: [
          {
            // Pages that claim success but aren't processed
            statusCode: 200,
            hasErrors: false,
            isProcessed: false,
          },
          {
            // Pages with no status code at all (partially created)
            statusCode: { $exists: false },
            hasErrors: false,
          },
          {
            // Pages that are marked as processing but never completed
            isProcessed: false,
            hasErrors: false,
            statusCode: { $ne: 0 }, // Exclude already marked failures
          },
        ],
      }).lean();

      return incompletePages;
    } catch (error) {
      logger.error("Error finding incomplete webpages", error);
      throw error;
    }
  }

  async markWebpagesAsFailed(
    userActivityId,
    errorMessage = "Processing incomplete"
  ) {
    try {
      const result = await WebpageCore.updateMany(
        {
          userActivityId,
          $or: [
            {
              statusCode: 200,
              hasErrors: false,
              isProcessed: false,
            },
            {
              statusCode: { $exists: false },
              hasErrors: false,
            },
            {
              isProcessed: false,
              hasErrors: false,
              statusCode: { $ne: 0 },
            },
          ],
        },
        {
          $set: {
            statusCode: 0,
            hasErrors: true,
            errorMessage: errorMessage,
            isProcessed: false,
            processedAt: new Date(),
            seoScore: 0,
            seoGrade: "F",
            lastCrawled: new Date(),
          },
        }
      );

      logger.info(
        `Marked ${result.modifiedCount} incomplete webpages as failed for activity ${userActivityId}`
      );

      return result;
    } catch (error) {
      logger.error("Error marking webpages as failed", error);
      throw error;
    }
  }

  async getIncompleteWebpagesCount(userActivityId) {
    try {
      const count = await WebpageCore.countDocuments({
        userActivityId,
        $or: [
          {
            statusCode: 200,
            hasErrors: false,
            isProcessed: false,
          },
          {
            statusCode: { $exists: false },
            hasErrors: false,
          },
          {
            isProcessed: false,
            hasErrors: false,
            statusCode: { $ne: 0 },
          },
        ],
      });

      return count;
    } catch (error) {
      logger.error("Error getting incomplete webpages count", error);
      return 0;
    }
  }

  async findSitemap(websiteUrl, userId = null, rateLimiter = null) {
    try {
      if (!urlUtils.isValidUrl(websiteUrl)) {
        return {
          error:
            "Invalid URL format. URL must start with 'http://' or 'https://'",
        };
      }

      const parsedUrl = new URL(websiteUrl);
      const robotsTxtUrl = `${parsedUrl.origin}/robots.txt`;
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/xml, text/xml, */*",
      };

      let sitemapUrls = new Set();

      if (rateLimiter) {
        await rateLimiter.acquire(parsedUrl.hostname);
      }

      try {
        const response = await axios.get(robotsTxtUrl, {
          headers,
          timeout: 8000,
          validateStatus: (status) => status < 500,
        });

        if (response.status === 200) {
          const lines = response.data.split("\n");
          lines
            .filter((line) => line.toLowerCase().startsWith("sitemap:"))
            .map((line) => line.replace(/sitemap:/i, "").trim())
            .filter((url) => url.startsWith("http"))
            .forEach((url) => sitemapUrls.add(url));

          if (rateLimiter) {
            rateLimiter.reportSuccess(parsedUrl.hostname);
          }
        }
      } catch (error) {
        logger.warn(
          "robots.txt not accessible, checking alternative locations...",
          userId
        );
        if (rateLimiter) {
          rateLimiter.reportError(parsedUrl.hostname, "robots_txt");
        }
      }

      const extraSitemapLocations = [
        `${parsedUrl.origin}/sitemap.xml`,
        `${parsedUrl.origin}/sitemap_index.xml`,
        `${parsedUrl.origin}/sitemaps/sitemap.xml`,
        `${parsedUrl.origin}/sitemap1.xml`,
        `${parsedUrl.origin}/feeds/sitemap.xml`,
        `${parsedUrl.origin}/sitemap-pages.xml`,
        `${parsedUrl.origin}/xmlsitemap.php`,
      ];

      const sitemapLimiter = await this.createLimiter(2);
      const sitemapChecks = extraSitemapLocations.map((sitemapUrl) =>
        sitemapLimiter(async () => {
          try {
            if (rateLimiter) {
              await rateLimiter.acquire(parsedUrl.hostname);
            }

            const response = await axios.get(sitemapUrl, {
              headers,
              timeout: 8000,
              validateStatus: (status) => status === 200,
            });

            const contentType = response.headers["content-type"] || "";
            const content = response.data.toString();

            const isValidXML =
              contentType.includes("xml") ||
              content.trim().startsWith("<?xml") ||
              content.includes("<urlset") ||
              content.includes("<sitemapindex");

            if (isValidXML) {
              if (rateLimiter) {
                rateLimiter.reportSuccess(parsedUrl.hostname);
              }
              return sitemapUrl;
            } else {
              return null;
            }
          } catch (error) {
            return null;
          }
        })
      );

      const validSitemaps = (await Promise.all(sitemapChecks)).filter(Boolean);
      validSitemaps.forEach((url) => sitemapUrls.add(url));

      const finalSitemaps = Array.from(sitemapUrls);

      if (finalSitemaps.length === 0) {
        logger.warn(`No valid XML sitemaps found for ${websiteUrl}`, userId);
        return {
          error:
            "No valid XML sitemaps found. The website may not have sitemaps or they may be protected.",
        };
      }

      logger.info(
        `Found ${finalSitemaps.length} valid XML sitemaps for ${websiteUrl}`,
        userId
      );
      return finalSitemaps;
    } catch (error) {
      logger.error("Error fetching sitemap", error, userId);
      return { error: error.message };
    }
  }

  async processWebsite(
    sitemapUrls,
    userId,
    activityId,
    websiteUrl,
    options = {}
  ) {
    this.ensureInitialized();

    try {
      if (!Array.isArray(sitemapUrls) || sitemapUrls.length === 0) {
        throw new Error("No sitemap URLs provided");
      }

      if (!userId) {
        throw new Error("User ID is required");
      }

      const result = await this.jobManager.processWebsite(
        sitemapUrls,
        userId,
        activityId,
        websiteUrl,
        options
      );

      logger.info(`Website processing initiated: ${result.jobId}`, userId);
      return result;
    } catch (error) {
      logger.error("Error processing website", error, userId);
      throw error;
    }
  }

  async stopCrawl(activityId) {
    this.ensureInitialized();

    try {
      logger.info(`Attempting to stop crawl for activity ${activityId}`);

      if (!activityId) {
        throw new Error("Activity ID is required");
      }

      logger.info(`Attempting to stop crawl for activity ${activityId}`);

      let removedFromQueue = false;
      let jobFoundAndActive = false; // job is in queue and currently running (worker will see stop via DB/flag)
      const activity = await this.activityService.getActivity(activityId);
      if (activity?.userId != null && activity?.websiteUrl) {
        const userId = String(activity.userId);
        const normalizedUrl = (activity.websiteUrl || "").trim();
        const siteHash = crypto
          .createHash("sha256")
          .update(normalizedUrl)
          .digest("hex")
          .slice(0, 16);
        // const bullJobId = `crawl_${userId}_${siteHash}`;
        // const queueJob = await scrapeQueue.getJob(bullJobId).catch(() => null);
        const jobId = `crawlV2_phase1_${userId}_${siteHash}`;
        const existingJob = await crawlV2Phase1Queue.getJob(jobId).catch(() => null);
        if (existingJob) {
          const state = await existingJob.getState();

          if (state === "waiting" || state === "delayed") {
            try {
              await existingJob.remove();
              removedFromQueue = true;
              logger.info(
                `Removed crawl job ${jobId} from queue (state: ${state})`
              );
            } catch (removeErr) {
              logger.warn(
                `Could not remove job ${jobId} from queue: ${removeErr.message}`
              );
            }
          } else if (state === "active") {
            jobFoundAndActive = true;
            logger.info(
              `Crawl job ${jobId} is active (locked by worker); sending stop signal via jobManager`
            );
            // removedFromQueue stays false; jobManager.stopJob will signal the worker to stop
          }
        }
      }

      const stopped = await this.jobManager.stopJob(activityId);
      if (stopped || removedFromQueue || jobFoundAndActive) {
        logger.info(`Crawl stopped for activity ${activityId}`);
        return {
          success: true,
          message: "Crawl stop signal sent successfully",
          activityId: activityId,
        };
      }

      throw new Error(
        "No active job found for this activity or job is not in a stoppable state"
      );
    } catch (error) {
      logger.error("Error stopping crawl", error);
      throw error;
    }
  }

  createLimiter(concurrency) {
    const queue = [];
    const priorityQueue = [];
    let activeCount = 0;

    const next = () => {
      activeCount--;

      // Process priority queue first
      if (priorityQueue.length > 0) {
        const { fn, resolve, reject } = priorityQueue.shift();
        run(fn).then(resolve, reject);
      } else if (queue.length > 0) {
        const { fn, resolve, reject } = queue.shift();
        run(fn).then(resolve, reject);
      }
    };

    const run = async (fn) => {
      activeCount++;
      try {
        return await fn();
      } finally {
        next();
      }
    };

    const limit = (fn, priority = false) => {
      if (activeCount < concurrency) {
        return run(fn);
      }

      return new Promise((resolve, reject) => {
        const item = { fn, resolve, reject, queued: Date.now() };
        if (priority) {
          priorityQueue.push(item);
        } else {
          queue.push(item);
        }
      });
    };

    limit.activeCount = () => activeCount;
    limit.pendingCount = () => queue.length + priorityQueue.length;
    limit.getStats = () => ({
      active: activeCount,
      pending: queue.length,
      priority: priorityQueue.length,
      total: activeCount + queue.length + priorityQueue.length,
    });

    return limit;
  }

  isCloudflareBlock(response) {
    if (!response) return false;

    const { headers, data } = response;

    // Check for Cloudflare headers
    const cfHeaders = ["cf-ray", "server"];
    const hasCloudflareHeaders = cfHeaders.some(
      (header) =>
        headers[header] &&
        headers[header].toString().toLowerCase().includes("cloudflare")
    );

    // Check response body for Cloudflare content
    const hasCloudflareContent =
      data &&
      (data.includes("Cloudflare") ||
        data.includes("Attention Required") ||
        data.includes("cf-wrapper") ||
        data.includes("Sorry, you have been blocked"));

    return hasCloudflareHeaders || hasCloudflareContent;
  }

  // Add this helper method for alternative accessibility checks
  async tryAlternativeCheck(websiteUrl, headers) {
    const alternativeEndpoints = [
      "/robots.txt",
      "/sitemap.xml",
      "/favicon.ico",
    ];
    const baseUrl = new URL(websiteUrl).origin;

    for (const endpoint of alternativeEndpoints) {
      try {
        const altUrl = baseUrl + endpoint;
        const response = await axios.head(altUrl, {
          timeout: 5000,
          headers,
          validateStatus: (status) => status < 500,
        });

        if (response.status < 400) {
          console.log(`✅ Alternative endpoint accessible: ${endpoint}`);
          return true;
        }
      } catch (error) {
        console.log(`⚠️ Alternative endpoint failed: ${endpoint}`);
      }
    }

    return false;
  }

  async checkWebsiteAccessibility(websiteUrl, timeout = 10000) {
    try {
      // Create better headers that mimic a real browser
      const browserHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        Connection: "keep-alive",
      };

      // First try a HEAD request (faster)
      try {
        const headResponse = await axios.head(websiteUrl, {
          timeout: timeout / 2,
          headers: browserHeaders,
          validateStatus: (status) => status < 500,
          maxRedirects: 5,
        });

        if (headResponse.status < 400) {
          console.log(`✅ HEAD request successful: ${headResponse.status}`);
          return true;
        }
      } catch (headError) {
        console.log(`⚠️ HEAD request failed, trying GET: ${headError.message}`);
      }

      // If HEAD fails, try GET request
      const response = await axios.get(websiteUrl, {
        timeout,
        headers: browserHeaders,
        validateStatus: (status) => status < 500,
        maxRedirects: 5,
        maxContentLength: 1024 * 1024, // Limit to 1MB
        responseType: "text",
      });

      // Consider 200-399 as accessible
      if (response.status < 400) {
        console.log(`✅ GET request successful: ${response.status}`);
        return true;
      }

      // Check if it's a Cloudflare block
      if (response.status === 403 && this.isCloudflareBlock(response)) {
        console.log(`🛡️ Cloudflare protection detected for ${websiteUrl}`);
        // Try alternative check with robots.txt
        return await this.tryAlternativeCheck(websiteUrl, browserHeaders);
      }

      console.log(`❌ Website returned status: ${response.status}`);
      return false;
    } catch (error) {
      console.log(`❌ Accessibility check failed: ${error.message}`);

      // If it's a Cloudflare block, try alternative method
      if (
        error.response?.status === 403 &&
        this.isCloudflareBlock(error.response)
      ) {
        console.log(`🛡️ Detected Cloudflare block, trying alternative check`);
        const browserHeaders = {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
        };
        return await this.tryAlternativeCheck(websiteUrl, browserHeaders);
      }

      return false;
    }
  }
  // Utility methods

  async getSystemHealth() {
    this.ensureInitialized();

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        jobManager: this.jobManager.getStats(),
        sessionManager: this.sessionManager.getStats(),
        webScraper: this.webScraper.getStats(),
        activeJobs: this.jobManager.getActiveJobs(),
        queueStatus: this.jobManager.getQueueStatus(),
      },
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };

    // Determine overall health
    const activeJobs = health.services.activeJobs.length;
    const queueLength = health.services.queueStatus.queueLength;

    if (activeJobs >= config.concurrency.max_users) {
      health.status = "degraded";
      health.issues = ["At maximum user capacity"];
    } else if (queueLength > 10) {
      health.status = "degraded";
      health.issues = ["High queue length"];
    }

    return health;
  }

  async getUserActivity(userId, activityId = null) {
    this.ensureInitialized();

    if (activityId) {
      return await this.activityService.getActivity(activityId);
    } else {
      return await this.activityService.getUserActivities(userId);
    }
  }

  async getWebpageData(userId, websiteUrl, options = {}) {
    this.ensureInitialized();

    const {
      page = 1,
      limit = 50,
      sortBy = "seoScore",
      sortOrder = "desc",
      filters = {},
    } = options;

    return await this.activityService.getWebpagesForUser(userId, websiteUrl, {
      page,
      limit,
      sortBy,
      sortOrder,
      filters,
    });
  }

  resetBlockedDomains(domains = null) {
    this.ensureInitialized();

    if (domains && Array.isArray(domains)) {
      domains.forEach((domain) => {
        this.webScraper.rateLimiter.resetDomain(domain);
      });
      return `Reset ${domains.length} domains`;
    } else {
      const count = this.webScraper.rateLimiter.resetAllBlocked();
      return `Reset ${count} blocked domains`;
    }
  }

  // Internal methods

  isValidUrl(url) {
    try {
      new URL(url);
      return url.startsWith("http://") || url.startsWith("https://");
    } catch {
      return false;
    }
  }

  startPeriodicTasks() {
    // Health checks every minute
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        if (health.status !== "healthy") {
          logger.warn(`System health check: ${health.status}`, null);
        }
      } catch (error) {
        logger.error("Health check failed", error);
      }
    }, config.performance.health_check_interval);

    // Cleanup tasks every 5 minutes
    this.cleanupInterval = setInterval(() => {
      try {
        this.webScraper.rateLimiter.cleanup();
        this.sessionManager.cleanup();

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        logger.debug("Periodic cleanup completed");
      } catch (error) {
        logger.error("Cleanup task failed", error);
      }
    }, config.memory.cleanup_interval);

    logger.info("Periodic tasks started");
  }

  setupShutdownHandlers() {
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      try {
        config.concurrency.max_users = 0;

        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);

        // ADD - CLEANUP ON SHUTDOWN
        await crashRecoveryService.cleanupOnShutdown();

        const shutdownTimeout = 30000;
        const startShutdown = Date.now();

        while (this.jobManager.getActiveJobs().length > 0) {
          if (Date.now() - startShutdown > shutdownTimeout) {
            logger.warn("Shutdown timeout reached, forcing exit");
            break;
          }
          await this.sleep(1000);
        }

        this.jobManager.cleanup();
        this.webScraper.cleanup();

        logger.info("Graceful shutdown completed");
        process.exit(0);
      } catch (error) {
        logger.error("Error during shutdown", error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled promise rejection", reason);
      gracefulShutdown("unhandledRejection");
    });
  }

  ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "Scraper service not initialized. Call initialize() first."
      );
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Create singleton instance
const scraperService = new ScraperService();

// Export both the service instance and individual components for flexibility
module.exports = {
  scraperService,
  JobManager,
  SessionManager,
  WebScraper,
  SitemapService,
  ActivityService,

  async validateWebsite(websiteUrl) {
    await scraperService.initialize();
    return scraperService.validateWebsite(websiteUrl);
  },

  async processAllSitemapsAndWebpages(
    sitemapUrls,
    userId,
    websiteUrl,
    options
  ) {
    await scraperService.initialize();
    return scraperService.processWebsite(
      sitemapUrls,
      userId,
      websiteUrl,
      options
    );
  },

  async getSystemHealth() {
    await scraperService.initialize();
    return scraperService.getSystemHealth();
  },

  resetBlockedDomains(domains) {
    return scraperService.resetBlockedDomains(domains);
  },

  async gracefulShutdown() {
    if (scraperService.initialized) {
      process.emit("SIGTERM");
    }
  },
};
