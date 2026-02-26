// services/crash-recovery-service.js - NEW FILE

const { UserActivity } = require("../models/activity-models");
const logger = require("../config/logger");
const os = require("os");
const crypto = require("crypto");
const {scraperService} = require("./scraper-service");

class CrashRecoveryService {
  constructor() {
    this.serverInstanceId = this.generateInstanceId();
    this.stalledCheckInterval = null;
    this.STALLED_THRESHOLD = 30000; // 30 seconds without heartbeat
    // this.STALLED_THRESHOLD = 60000; // 60 seconds without heartbeat
    this.CHECK_INTERVAL = 10000; // Check every 10 seconds
  }

  generateInstanceId() {
    const hostname = os.hostname();
    const pid = process.pid;
    const timestamp = Date.now();
    return crypto.createHash('md5').update(`${hostname}-${pid}-${timestamp}`).digest('hex').substring(0, 12);
  }

  getInstanceId() {
    return this.serverInstanceId;
  }

  async recoverFromCrash() {
    try {
      logger.info(`🔄 Starting crash recovery for instance: ${this.serverInstanceId}`);

      // Find all activities stuck in processing states
      const stuckActivities = await UserActivity.find({
        status: { $in: ["processing", "analyzing"] },
        $or: [
          { serverInstance: { $ne: this.serverInstanceId } },
          { serverInstance: { $exists: false } },
          { serverInstance: null }
        ]
      });

      if (stuckActivities.length === 0) {
        logger.info("✅ No stuck activities found - clean startup");
        return { recovered: 0, failed: 0 };
      }

      logger.warn(`⚠️ Found ${stuckActivities.length} stuck activities from previous crash`);

      let recovered = 0;
      let failed = 0;

      for (const activity of stuckActivities) {
        try {
          const timeSinceUpdate = Date.now() - (activity.lastHeartbeat || activity.lastUpdated || activity.startTime).getTime();
          
          // If updated recently (< 30s), might still be running
          if (timeSinceUpdate < this.STALLED_THRESHOLD) {
            logger.info(`Skipping recent activity ${activity._id} - might still be active`);
            continue;
          }

          // Mark as failed due to crash
          await UserActivity.findByIdAndUpdate(activity._id, {
            $set: {
              status: "failed",
              endTime: new Date(),
              errorMessages: [
                ...(activity.errorMessages || []),
                `Server crashed or restarted. Last heartbeat: ${new Date(activity.lastHeartbeat || activity.lastUpdated).toISOString()}`
              ],
              isSitemapCrawling: 0,
              isWebpageCrawling: 0,
              crashRecovered: true,
              isStalled: true,
              lastUpdated: new Date()
            }
          });

          // Cleanup incomplete webpages
          // const WebpageService = require("./webpage-service");
          // const webpageService = new WebpageService();
          // await webpageService.markWebpagesAsFailed(
          //   activity._id,
          //   "Server crash - incomplete processing"
          // );
          await scraperService.markWebpagesAsFailed(
            activity._id,
            "Server crash - incomplete processing"
          );
          failed++;
          logger.warn(`❌ Marked activity ${activity._id} as failed (crash recovery)`);
        } catch (error) {
          logger.error(`Error recovering activity ${activity._id}`, error);
        }
      }

      logger.info(`🔄 Crash recovery complete: ${failed} activities marked as failed`);
      return { recovered, failed };
    } catch (error) {
      logger.error("Error during crash recovery", error);
      throw error;
    }
  }

  startStalledJobMonitor() {
    if (this.stalledCheckInterval) {
      return;
    }

    logger.info("🔍 Starting stalled job monitor");

    this.stalledCheckInterval = setInterval(async () => {
      try {
        await this.checkForStalledJobs();
      } catch (error) {
        logger.error("Error checking for stalled jobs", error);
      }
    }, this.CHECK_INTERVAL);
  }

  async checkForStalledJobs() {
    try {
      const stalledThreshold = new Date(Date.now() - this.STALLED_THRESHOLD);

      const stalledActivities = await UserActivity.find({
        status: { $in: ["processing", "analyzing"] },
        lastHeartbeat: { $lt: stalledThreshold },
        isStalled: false
      });

      if (stalledActivities.length === 0) {
        return;
      }

      logger.warn(`⚠️ Found ${stalledActivities.length} stalled jobs`);

      for (const activity of stalledActivities) {
        try {
          logger.warn(`⚠️ Marking activity ${activity._id} as stalled (no heartbeat)`);

          await UserActivity.findByIdAndUpdate(activity._id, {
            $set: {
              status: "failed",
              endTime: new Date(),
              errorMessages: [
                ...(activity.errorMessages || []),
                `Crawl stopped responding after ${this.STALLED_THRESHOLD / 1000}s. Your data is safe. Start a new crawl to continue.`
              ],
              isSitemapCrawling: 0,
              isWebpageCrawling: 0,
              isStalled: true,
              lastUpdated: new Date()
            }
          });

          // Cleanup incomplete webpages
          // const WebpageService = require("./webpage-service");
          // const webpageService = new WebpageService();
          // await webpageService.markWebpagesAsFailed(
          //   activity._id,
          //   "Job stalled - no heartbeat"
          // );
          await scraperService.markWebpagesAsFailed(
            activity._id,
            "Job stalled - no heartbeat"
          );
        } catch (error) {
          logger.error(`Error marking stalled activity ${activity._id}`, error);
          console.log(error);
        }
      }
    } catch (error) {
      logger.error("Error in checkForStalledJobs", error);
    }
  }

  stopStalledJobMonitor() {
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval);
      this.stalledCheckInterval = null;
      logger.info("🛑 Stopped stalled job monitor");
    }
  }

  async updateHeartbeat(activityId) {
    try {
      await UserActivity.findByIdAndUpdate(activityId, {
        $set: {
          lastHeartbeat: new Date(),
          serverInstance: this.serverInstanceId
        }
      });
    } catch (error) {
      logger.error(`Error updating heartbeat for ${activityId}`, error);
    }
  }

  async markActivityAsActive(activityId, jobId) {
    try {
      await UserActivity.findByIdAndUpdate(activityId, {
        $set: {
          lastHeartbeat: new Date(),
          serverInstance: this.serverInstanceId,
          jobId: jobId,
          isStalled: false,
          crashRecovered: false
        }
      });
    } catch (error) {
      logger.error(`Error marking activity as active ${activityId}`, error);
    }
  }

  async cleanupOnShutdown() {
    try {
      logger.info("🧹 Cleaning up activities on graceful shutdown");

      await UserActivity.updateMany(
        {
          serverInstance: this.serverInstanceId,
          status: { $in: ["processing", "analyzing"] }
        },
        {
          $set: {
            status: "stopped",
            endTime: new Date(),
            isSitemapCrawling: 0,
            isWebpageCrawling: 0,
            errorMessages: ["Server shutdown gracefully"],
            lastUpdated: new Date()
          }
        }
      );

      this.stopStalledJobMonitor();
    } catch (error) {
      logger.error("Error during shutdown cleanup", error);
    }
  }
}

// Singleton instance
const crashRecoveryService = new CrashRecoveryService();

module.exports = crashRecoveryService;