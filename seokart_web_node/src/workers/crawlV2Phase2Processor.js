"use strict";

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { connect } = require("../config/database");
const { initEmitter, emitToUser } = require("../services/socket-emitter");
const SlowAnalyzerJobV2 = require("../jobs/slow-analyzer-v2");
const crawlV2Config = require("../config/crawl-v2");
const logger = require("../config/logger");

let initialized = false;

/**
 * Crawl V2 Phase2: grammar check, duplicate detection, link validation, SEO score, save.
 * Processes in chunks to support 100K+ pages without loading all into memory.
 */
module.exports = async function (job) {
  if (!initialized) {
    await connect();
    await initEmitter();
    initialized = true;
    logger.info("Crawl V2 Phase2 worker initialized");
  }

  const { activityId, userId, websiteUrl } = job.data;
  if (!activityId || !userId || !websiteUrl) {
    throw new Error("Crawl V2 Phase2 job missing required data: activityId, userId, websiteUrl");
  }

  logger.info(`Crawl V2 Phase2 job ${job.id} starting for activity ${activityId}`, userId);

  const slowAnalyzerJob = new SlowAnalyzerJobV2();
  const result = await slowAnalyzerJob.analyzeWebpagesChunked(userId, activityId, websiteUrl, {
    chunkSize: crawlV2Config.phase2ChunkSize,
  });

  const { emitUserActivitiesUpdate } = require("../controllers/scraperController");
  emitToUser(userId, "crawl_complete", {
    activityId,
    websiteUrl,
    status: "completed",
    slowAnalysisCompleted: true,
    analyzed: result.analyzed,
    updated: result.updated,
    totalChunks: result.totalChunks,
    processingTime: result.totalTime,
    timestamp: new Date().toISOString(),
  });

  if (typeof emitUserActivitiesUpdate === "function") {
    await emitUserActivitiesUpdate(userId);
  }

  logger.info(`Crawl V2 Phase2 job ${job.id} completed for activity ${activityId}`, userId);

  return {
    success: true,
    activityId,
    analyzed: result.analyzed,
    updated: result.updated,
    totalChunks: result.totalChunks,
    totalTime: result.totalTime,
  };
};
