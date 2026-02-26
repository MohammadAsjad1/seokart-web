const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

const { connect } = require("../config/database");
const SlowAnalyzerJob = require("../jobs/slow-analyzer");
const { initEmitter, emitToUser } = require("../services/socket-emitter");
const logger = require("../config/logger");

let initialized = false;

/**
 * Analysis processor for the analysis queue (slow analyzer as background job).
 * Runs duplicate detection, link validation, and score recalc for a crawl activity.
 */
module.exports = async function (job) {
  if (!initialized) {
    await connect();
    await initEmitter();
    initialized = true;
    logger.info("Analysis worker sandbox initialized");
  }

  const { activityId, userId, websiteUrl } = job.data;

  if (!activityId || !userId || !websiteUrl) {
    throw new Error("Analysis job missing required data: activityId, userId, websiteUrl");
  }

  logger.info(`Analysis job ${job.id} starting for activity ${activityId}`, userId);

  const slowAnalyzerJob = new SlowAnalyzerJob();
  console.time("slow analyzer job")
  const result = await slowAnalyzerJob.analyzeWebpages(userId, activityId, websiteUrl);
  console.timeEnd("slow analyzer job")

  const { emitUserActivitiesUpdate } = require("../controllers/scraperController");

  emitToUser(userId, "analysis_completed", {
    activityId,
    websiteUrl,
    status: "completed",
    slowAnalysisCompleted: true,
    analyzed: result.analyzed,
    updated: result.updated,
    duplicatesFound: result.duplicatesFound,
    brokenLinksFound:
      (result.internalBrokenLinksFound || 0) + (result.externalBrokenLinksFound || 0),
    processingTime: result.totalTime,
    timestamp: new Date().toISOString(),
  });

  if (typeof emitUserActivitiesUpdate === "function") {
    await emitUserActivitiesUpdate(userId);
  }

  logger.info(`Analysis job ${job.id} completed for activity ${activityId}`, userId);

  return {
    success: true,
    activityId,
    analyzed: result.analyzed,
    updated: result.updated,
    totalTime: result.totalTime,
  };
};
