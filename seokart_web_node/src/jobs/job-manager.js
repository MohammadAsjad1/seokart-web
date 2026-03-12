const FastScraperJob = require("./fast-scraper");
const SlowAnalyzerJob = require("./slow-analyzer");
const SitemapService = require("../services/sitemap-service");
const analysisQueue = require("../queue/analysisQueue");
const { Sitemap } = require("../models/webpage-models");
const logger = require("../config/logger");
const WebpageService = require("../services/webpage-service");
const crashRecoveryService = require("../services/crash-recovery-service");
// Lazy require to avoid circular dependency: scraper-service requires this module
function getScraperService() {
  const { scraperService } = require("../services/scraper-service");
  return scraperService;
}

class JobManager {
  constructor() {
    this.activeJobs = new Map();
    this.jobQueue = [];
    this.sitemapService = new SitemapService();
    this.webpageService = new WebpageService();
    this.socketService = null;
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
    };

    this.heartbeatIntervals = new Map();
    this.HEARTBEAT_FREQUENCY = 5000;
  }

  // Initialize with socket service
  initialize(socketService) {
    this.socketService = socketService;
    logger.info("JobManager initialized");

    if (!this.webpageService) {
      const WebpageService = require("../services/webpage-service");
      this.webpageService = new WebpageService();
    }
  }

  startHeartbeat(activityId, jobId) {
    if (this.heartbeatIntervals.has(jobId)) {
      return;
    }

    logger.debug(`💓 Starting heartbeat for job ${jobId}`);

    const interval = setInterval(async () => {
      try {
        await crashRecoveryService.updateHeartbeat(activityId);
      } catch (error) {
        logger.error(`Heartbeat error for ${jobId}`, error);
      }
    }, this.HEARTBEAT_FREQUENCY);

    this.heartbeatIntervals.set(jobId, interval);
  }

  stopHeartbeat(jobId) {
    const interval = this.heartbeatIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(jobId);
      logger.debug(`💔 Stopped heartbeat for job ${jobId}`);
    }
  }

  async processWebsite(
    sitemapUrls,
    userId,
    activityId,
    websiteUrl,
    options = {}
  ) {
    const jobId = `${userId}_${activityId}`;

    try {
      this.stats.totalJobs++;
      this.stats.activeJobs++;

      logger.info(`Starting job ${jobId} for website: ${websiteUrl}`, userId);

      this.activeJobs.set(jobId, {
        userId,
        activityId: activityId.toString(),
        websiteUrl,
        startTime: Date.now(),
        status: "starting",
        fastScraperJob: null,
      });

      // ADD - MARK AS ACTIVE AND START HEARTBEAT
      await crashRecoveryService.markActivityAsActive(activityId, jobId);
      this.startHeartbeat(activityId, jobId);

      logger.info(`Phase 1: Processing ${sitemapUrls.length} sitemaps`, userId);
      this.activeJobs.get(jobId).status = "processing_sitemaps";

      const sitemapResult =
        await this.sitemapService.processSitemapsAndSaveUrls(
          sitemapUrls,
          activityId,
          userId
        );

      const allUrls = sitemapResult.extractedUrls;

      if (!allUrls || allUrls.length === 0) {
        throw new Error("No URLs found in sitemaps");
      }

      logger.info(`Phase 2: Fast scraping ${allUrls.length} URLs`, userId);
      this.activeJobs.get(jobId).status = "fast_scraping";

      const fastScraperJob = new FastScraperJob();
      this.activeJobs.get(jobId).fastScraperJob = fastScraperJob;

      const fastResults = await fastScraperJob.processWebpages(
        allUrls,
        userId,
        activityId,
        websiteUrl
      );

      // CHECK IF STOPPED
      if (fastScraperJob.scraper.shouldStop || fastResults.stopped) {
        this.activeJobs.get(jobId).status = "stopped";
        this.stats.activeJobs--;

        // ADD - STOP HEARTBEAT
        this.stopHeartbeat(jobId);

        logger.info(`Job ${jobId} stopped by user`, userId);

        const cleanupResult = await this.cleanupIncompleteWebpages(
          activityId,
          userId,
          "Scraping stopped by user"
        );

        const totalTime = Date.now() - this.activeJobs.get(jobId).startTime;
        this.activeJobs.delete(jobId);

        return {
          jobId,
          totalUrls: allUrls.length,
          sitemaps: sitemapUrls.length,
          sitemapStats: sitemapResult,
          fastResults: {
            successful: fastResults.successful,
            failed: fastResults.failed,
            totalTime: fastResults.totalTime,
          },
          cleanupResults: cleanupResult,
          processingTime: totalTime,
          slowAnalysisCompleted: false,
          stoppedByUser: true,
        };
      }

      // Queue slow analyzer as background job (same pattern as web crawler)
      logger.info(`Phase 3: Queuing slow analysis as background job`, userId);
      this.activeJobs.get(jobId).status = "analysis_queued";

      let analysisQueued = false;
      try {
        const existingAnalysisJob = await analysisQueue.getJob(`analysis_${activityId}`);
        if (existingAnalysisJob) {
          const state = await existingAnalysisJob.getState();
          if (["waiting", "delayed", "active"].includes(state)) {
            analysisQueued = true;
            logger.info(`Analysis job already queued for activity ${activityId}`, userId);
            return;
          }
          await existingAnalysisJob.remove();
          logger.info(`Analysis job removed for activity ${activityId}`, userId);
        }
        // ADD - QUEUE SLOW ANALYSIS
        const job = await analysisQueue.add(
          "analysis",
          { activityId: activityId.toString(), userId, websiteUrl },
          { jobId: `analysis_${activityId}`, removeOnComplete: true }
        );
        logger.info(`Analysis job queued for activity ${activityId}`, userId);
        logger.info(`Analysis job ID: ${job.id}`, userId);
        analysisQueued = true;
      } catch (queueErr) {
        logger.warn(`Analysis queue add failed, running analyzer in-process: ${queueErr.message}`, userId);
      }

      if (!analysisQueued) {
        logger.info(`Analysis job not queued, running analyzer in-process`, userId);
        this.activeJobs.get(jobId).status = "slow_analysis";
        const slowAnalyzerJob = new SlowAnalyzerJob();
        const slowResults = await slowAnalyzerJob.analyzeWebpages(userId, activityId, websiteUrl);
        this.activeJobs.get(jobId).status = "completed";
        this.stats.completedJobs++;
        this.stats.activeJobs--;
        this.stopHeartbeat(jobId);
        const totalTime = Date.now() - this.activeJobs.get(jobId).startTime;
        this.activeJobs.delete(jobId);
        return {
          jobId,
          totalUrls: allUrls.length,
          sitemaps: sitemapUrls.length,
          sitemapStats: sitemapResult,
          fastResults: { successful: fastResults.successful, failed: fastResults.failed, totalTime: fastResults.totalTime },
          slowResults: {
            analyzed: slowResults.analyzed,
            updated: slowResults.updated,
            duplicatesFound: slowResults.duplicatesFound,
            brokenLinksFound: slowResults.brokenLinksFound,
            totalTime: slowResults.totalTime,
          },
          processingTime: totalTime,
          slowAnalysisCompleted: true,
        };
      }

      this.activeJobs.get(jobId).status = "completed";
      this.stats.completedJobs++;
      this.stats.activeJobs--;
      this.stopHeartbeat(jobId);

      const totalTime = Date.now() - this.activeJobs.get(jobId).startTime;

      logger.info(
        `Job ${jobId} scrape completed; analysis queued (${totalTime}ms)`,
        userId
      );

      this.activeJobs.delete(jobId);

      return {
        jobId,
        totalUrls: allUrls.length,
        sitemaps: sitemapUrls.length,
        sitemapStats: sitemapResult,
        fastResults: {
          successful: fastResults.successful,
          failed: fastResults.failed,
          totalTime: fastResults.totalTime,
        },
        processingTime: totalTime,
        slowAnalysisCompleted: false,
        slowAnalysisPending: true,
      };
    } catch (error) {
      this.stats.failedJobs++;
      this.stats.activeJobs--;

      // ADD - STOP HEARTBEAT ON FAILURE
      this.stopHeartbeat(jobId);

      logger.error(`Job ${jobId} failed`, error, userId);

      try {
        const cleanupResult = await this.cleanupIncompleteWebpages(
          activityId,
          userId,
          `Job failed: ${error.message}`
        );

        logger.info(
          `Cleanup on failure: ${cleanupResult.updated} pages marked as failed`,
          userId
        );
      } catch (cleanupError) {
        logger.error(
          "Error during cleanup after job failure",
          cleanupError,
          userId
        );
      }

      if (this.activeJobs.has(jobId)) {
        this.activeJobs.get(jobId).status = "failed";
        this.activeJobs.get(jobId).error = error.message;
      }

      setTimeout(() => {
        this.activeJobs.delete(jobId);
      }, 5000);

      throw error;
    }
  }


    async cleanupIncompleteWebpages(activityId, userId, errorMessage) {
    try {
      if (!this.webpageService) {
        const WebpageService = require("../services/webpage-service");
        this.webpageService = new WebpageService();
      }

      // const incompleteCount = await this.webpageService.getIncompleteWebpagesCount(activityId);
      const incompleteCount = await getScraperService().getIncompleteWebpagesCount(activityId);
      
      if (incompleteCount === 0) {
        return { updated: 0, found: 0 };
      }

      const result = await this.webpageService.markWebpagesAsFailed(activityId, errorMessage);

      return {
        updated: result.modifiedCount,
        found: incompleteCount
      };
    } catch (error) {
      logger.error('Error in cleanupIncompleteWebpages', error, userId);
      return { updated: 0, found: 0, error: error.message };
    }
  }

  getJobByActivityId(activityId) {
    const activityIdStr = activityId.toString();

    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.activityId && job.activityId.toString() === activityIdStr) {
        return { jobId, job };
      }
    }

    return null;
  }

  async stopJob(activityId) {
    try {
      const jobInfo = this.getJobByActivityId(activityId);

      if (!jobInfo) {
        logger.warn(
          `No active job found for activity ${activityId} - checking database`
        );

        // ADD - CHECK IF CRASHED/STALLED
        const UserActivity = require("../models/activity-models").UserActivity;
        const activity = await UserActivity.findById(activityId);

        if (activity && ["processing", "analyzing"].includes(activity.status)) {
          // Mark as stopped even if not in memory
          await UserActivity.findByIdAndUpdate(activityId, {
            status: "stopped",
            endTime: new Date(),
            isSitemapCrawling: 0,
            isWebpageCrawling: 0,
            lastUpdated: new Date(),
            errorMessages: [
              ...(activity.errorMessages || []),
              "Stopped by user",
            ],
          });

          // Cleanup incomplete webpages
          // if (!this.webpageService) {
          //   const WebpageService = require("../services/webpage-service");
          //   this.webpageService = new WebpageService();
          // }
          await getScraperService().markWebpagesAsFailed(
            activityId,
            "Stopped by user"
          );

          return true;
        }

        return false;
      }

      const { jobId, job } = jobInfo;

      if (!job.fastScraperJob?.scraper) {
        logger.error(`No scraper instance for ${jobId}`);
        return false;
      }

      job.fastScraperJob.scraper.stopScraping();
      job.status = "stopping";

      // ADD - STOP HEARTBEAT
      this.stopHeartbeat(jobId);

      logger.info(`Stop signal sent for job ${jobId}`);

      return true;
    } catch (error) {
      console.log(error);
      logger.error(`Error stopping job for activity ${activityId}`, error);
      return false;
    }
  }

  async saveSitemapsToDb(sitemapUrls, activityId, userId) {
    try {
      logger.info(`Saving ${sitemapUrls.length} sitemaps to database`, userId);

      const sitemapIds = [];

      for (const sitemapUrl of sitemapUrls) {
        try {
          // Check if sitemap already exists for this activity
          let existingSitemap = await Sitemap.findOne({
            url: sitemapUrl,
            userActivityId: activityId,
          });

          if (existingSitemap) {
            // Update existing sitemap
            existingSitemap.status = 1; // Reset to pending
            existingSitemap.processedAt = undefined;
            existingSitemap.errorMessage = undefined;
            await existingSitemap.save();

            sitemapIds.push(existingSitemap._id);
            logger.debug(`Updated existing sitemap: ${sitemapUrl}`, userId);
          } else {
            // Create new sitemap record
            const newSitemap = new Sitemap({
              url: sitemapUrl,
              urlType: 0, // 0 = sitemap
              userActivityId: activityId,
              status: 1, // 1 = pending
              parentSitemaps: [], // Initial sitemaps have no parents
            });

            const savedSitemap = await newSitemap.save();
            sitemapIds.push(savedSitemap._id);
            logger.debug(`Saved new sitemap: ${sitemapUrl}`, userId);
          }
        } catch (error) {
          logger.warn(
            `Error saving sitemap ${sitemapUrl}: ${error.message}`,
            userId
          );
        }
      }

      logger.info(`Saved ${sitemapIds.length} sitemaps to database`, userId);
      return sitemapIds;
    } catch (error) {
      logger.error("Error saving sitemaps to database", error, userId);
      return [];
    }
  }

  async extractUrlsAndSaveSitemaps(
    sitemapUrls,
    activityId,
    userId,
    parentSitemapIds
  ) {
    try {
      logger.info(
        `Extracting URLs from ${sitemapUrls.length} sitemaps using SitemapService`,
        userId
      );

      // Use SitemapService to process sitemaps and save extracted URLs
      const result = await this.sitemapService.processSitemapsAndSaveUrls(
        sitemapUrls,
        activityId,
        userId
      );

      logger.info(
        `Successfully extracted ${result.totalUrls} URLs from ${result.totalSitemaps} sitemaps`,
        userId
      );

      return result.extractedUrls;
    } catch (error) {
      logger.error("Error extracting URLs using SitemapService", error, userId);
      throw error;
    }
  }

  // Enhanced sitemap processing to detect child sitemaps
  async processSitemapWithChildDetection(
    sitemapUrl,
    activityId,
    userId,
    parentSitemapId
  ) {
    try {
      const axios = require("axios");
      const xml2js = require("xml2js");

      // Fetch sitemap content
      const response = await axios.get(sitemapUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": this.sitemapService.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        maxContentLength: 50 * 1024 * 1024, // 50MB max
      });

      const urls = [];
      const childSitemaps = [];

      // Parse XML
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        trim: true,
      });

      const result = await parser.parseStringPromise(response.data);

      // Handle sitemap index (contains links to other sitemaps)
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        const sitemaps = Array.isArray(result.sitemapindex.sitemap)
          ? result.sitemapindex.sitemap
          : [result.sitemapindex.sitemap];

        for (const sitemap of sitemaps) {
          if (sitemap.loc) {
            childSitemaps.push(sitemap.loc);
          }
        }
      }

      // Handle regular sitemap (contains page URLs)
      if (result.urlset && result.urlset.url) {
        const urlEntries = Array.isArray(result.urlset.url)
          ? result.urlset.url
          : [result.urlset.url];

        for (const urlEntry of urlEntries) {
          if (urlEntry.loc) {
            const url = urlEntry.loc.toString().trim();
            if (this.sitemapService.isValidPageUrl(url)) {
              urls.push(url);
            }
          }
        }
      }

      return { urls, childSitemaps };
    } catch (error) {
      console.log(
        error,
        "Error processing sitemap in processSitemapWithChildDetection"
      );
      throw new Error(
        `Failed to process sitemap ${sitemapUrl}: ${error.message}`
      );
    }
  }

  // Save child sitemaps found in sitemap indexes
  async saveChildSitemaps(
    childSitemapUrls,
    activityId,
    userId,
    parentSitemapId
  ) {
    try {
      logger.debug(`Saving ${childSitemapUrls.length} child sitemaps`, userId);

      for (const childSitemapUrl of childSitemapUrls) {
        try {
          // Check if child sitemap already exists
          let existingChildSitemap = await Sitemap.findOne({
            url: childSitemapUrl,
            userActivityId: activityId,
          });

          if (existingChildSitemap) {
            // Update existing child sitemap to include parent
            if (
              !existingChildSitemap.parentSitemaps.includes(parentSitemapId)
            ) {
              existingChildSitemap.parentSitemaps.push(parentSitemapId);
              existingChildSitemap.status = 1; // Reset to pending
              await existingChildSitemap.save();
            }
          } else {
            // Create new child sitemap
            const newChildSitemap = new Sitemap({
              url: childSitemapUrl,
              urlType: 0, // 0 = sitemap
              userActivityId: activityId,
              status: 1, // 1 = pending
              parentSitemaps: [parentSitemapId],
            });

            await newChildSitemap.save();
            logger.debug(`Saved child sitemap: ${childSitemapUrl}`, userId);
          }

          // Process child sitemap recursively
          const childResult = await this.processSitemapWithChildDetection(
            childSitemapUrl,
            activityId,
            userId,
            parentSitemapId
          );

          // If child sitemap has more children, save them too
          if (
            childResult.childSitemaps &&
            childResult.childSitemaps.length > 0
          ) {
            await this.saveChildSitemaps(
              childResult.childSitemaps,
              activityId,
              userId,
              parentSitemapId
            );
          }
        } catch (error) {
          logger.warn(
            `Error saving child sitemap ${childSitemapUrl}: ${error.message}`,
            userId
          );
        }
      }
    } catch (error) {
      logger.error("Error saving child sitemaps", error, userId);
    }
  }

  // Save extracted webpage URLs to database
  async saveWebpageUrlsToDb(webpageUrls, activityId, userId) {
    try {
      logger.info(
        `Saving ${webpageUrls.length} webpage URLs to database`,
        userId
      );

      // Process in batches to avoid memory issues
      const batchSize = 100;
      let savedCount = 0;

      for (let i = 0; i < webpageUrls.length; i += batchSize) {
        const batch = webpageUrls.slice(i, i + batchSize);

        const operations = batch.map((url) => ({
          updateOne: {
            filter: {
              url: url,
              userActivityId: activityId,
            },
            update: {
              $set: {
                url: url,
                urlType: 1, // 1 = webpage
                userActivityId: activityId,
                status: 1, // 1 = pending
                updatedAt: new Date(),
              },
              $setOnInsert: {
                createdAt: new Date(),
                parentSitemaps: [],
              },
            },
            upsert: true,
          },
        }));

        try {
          const result = await Sitemap.bulkWrite(operations);
          savedCount += result.upsertedCount + result.modifiedCount;
        } catch (error) {
          logger.warn(
            `Error in batch operation for webpage URLs: ${error.message}`,
            userId
          );
        }
      }

      logger.info(`Saved ${savedCount} webpage URLs to database`, userId);
    } catch (error) {
      logger.error("Error saving webpage URLs to database", error, userId);
    }
  }

  // Update sitemap status
  async updateSitemapStatus(
    sitemapId,
    status,
    userId,
    processedAt = null,
    errorMessage = null
  ) {
    try {
      const updateData = { status };

      if (processedAt) {
        updateData.processedAt = processedAt;
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      await Sitemap.findByIdAndUpdate(sitemapId, updateData);
    } catch (error) {
      logger.warn(`Error updating sitemap status: ${error.message}`, userId);
    }
  }

  // Get sitemap statistics for an activity
  async getSitemapStats(activityId) {
    try {
      const stats = await Sitemap.aggregate([
        { $match: { userActivityId: activityId } },
        {
          $group: {
            _id: "$urlType",
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ["$status", 1] }, 1, 0] } },
            processed: { $sum: { $cond: [{ $eq: ["$status", 2] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", 3] }, 1, 0] } },
          },
        },
      ]);

      const result = {
        sitemaps: { total: 0, pending: 0, processed: 0, failed: 0 },
        webpages: { total: 0, pending: 0, processed: 0, failed: 0 },
      };

      stats.forEach((stat) => {
        if (stat._id === 0) {
          // sitemaps
          result.sitemaps = {
            total: stat.total,
            pending: stat.pending,
            processed: stat.processed,
            failed: stat.failed,
          };
        } else if (stat._id === 1) {
          // webpages
          result.webpages = {
            total: stat.total,
            pending: stat.pending,
            processed: stat.processed,
            failed: stat.failed,
          };
        }
      });

      return result;
    } catch (error) {
      logger.error("Error getting sitemap stats", error);
      return null;
    }
  }

  // Get active jobs
  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  // Get job status
  getJobStatus(jobId) {
    return this.activeJobs.get(jobId) || null;
  }

  // Get queue status
  getQueueStatus() {
    return {
      queueLength: this.jobQueue.length,
      activeJobs: this.stats.activeJobs,
      totalJobs: this.stats.totalJobs,
      completedJobs: this.stats.completedJobs,
      failedJobs: this.stats.failedJobs,
    };
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.totalJobs > 0
          ? ((this.stats.completedJobs / this.stats.totalJobs) * 100).toFixed(
              2
            ) + "%"
          : "0%",
      activeJobsList: this.getActiveJobs().map((job) => ({
        userId: job.userId,
        websiteUrl: job.websiteUrl,
        status: job.status,
        runtime: Date.now() - job.startTime,
      })),
    };
  }

  cleanup() {
    try {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes

      for (const [jobId, job] of this.activeJobs.entries()) {
        if (["completed", "failed", "stopped"].includes(job.status)) {
          if (now - job.startTime > maxAge) {
            this.activeJobs.delete(jobId);
          }
        }
      }

      logger.debug("JobManager cleanup completed");
    } catch (error) {
      logger.error("Error during JobManager cleanup", error);
    }
  }

  // Get detailed job information
  getJobDetails(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return null;

    return {
      ...job,
      runtime: Date.now() - job.startTime,
      phase: this.getPhaseDescription(job.status),
    };
  }

  getPhaseDescription(status) {
    const phases = {
      starting: "Initializing job",
      processing_sitemaps: "Processing sitemaps",
      fast_scraping: "Fast content scraping",
      slow_analysis: "Detailed content analysis",
      completed: "Job completed",
      failed: "Job failed",
      stopped: "Job stopped",
      stopping: "Stopping job",
    };

    return phases[status] || "Unknown phase";
  }
}

module.exports = JobManager;
