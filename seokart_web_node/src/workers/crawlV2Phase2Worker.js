const path = require("path");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");
const crawlV2Config = require("../config/crawl-v2");
const logger = require("../config/logger");

const worker = new Worker(
  "crawlV2Phase2",
  path.join(__dirname, "crawlV2Phase2Processor.js"),
  {
    connection,
    concurrency: crawlV2Config.phase2WorkerConcurrency,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Crawl V2 Phase2 job ${job.id} completed`);
  logger.info(`Crawl V2 Phase2 job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Crawl V2 Phase2 job ${job?.id} failed`, err);
  logger.error(`Crawl V2 Phase2 job ${job?.id} failed`, err);

  const { activityId, userId, websiteUrl } = job?.data || {};
  if (!activityId || !userId || !websiteUrl) return;

  try {
    const { connect } = require("../config/database");
    const { initEmitter, emitToUser } = require("../services/socket-emitter");
    const { UserActivity } = require("../models/activity-models");

    await connect();
    await initEmitter();

    const errorMessage = err?.message || String(err);
    await UserActivity.findByIdAndUpdate(activityId, {
      status: "failed",
      endTime: new Date(),
      errorMessages: [errorMessage],
      slowAnalysisError: errorMessage,
      isSitemapCrawling: 0,
      isWebpageCrawling: 0,
      lastUpdated: new Date(),
      lastHeartbeat: new Date(),
    });

    emitToUser(userId, "crawl_error", {
      websiteUrl,
      message: errorMessage,
      activityId,
      timestamp: new Date().toISOString(),
    });

    emitToUser(userId, "crawl_complete", {
      activityId,
      websiteUrl,
      status: "failed",
      slowAnalysisCompleted: false,
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });

    const { emitUserActivitiesUpdate } = require("../controllers/scraperController");
    if (typeof emitUserActivitiesUpdate === "function") {
      await emitUserActivitiesUpdate(userId);
    }

    logger.info(`Crawl V2 Phase2: activity ${activityId} marked failed and user notified`, userId);
  } catch (e) {
    logger.error("Crawl V2 Phase2: failed to update activity/notify user on job failure", e);
  }
});

console.log("🚀 Crawl V2 Phase2 worker started");
