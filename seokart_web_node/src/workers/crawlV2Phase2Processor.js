"use strict";

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const Redis = require("ioredis");
const { connect } = require("../config/database");
const { initEmitter, emitToUser } = require("../services/socket-emitter");
const LinkProcessor = require("../processors/link-processor");
const SlowAnalyzerJobV2 = require("../jobs/slow-analyzer-v2");
const crawlV2Config = require("../config/crawl-v2");
const logger = require("../config/logger");

let initialized = false;
let redisClient = null;

function getRedis() {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    });
  }
  return redisClient;
}

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

  const redis = getRedis();
  const slowAnalyzerJob = new SlowAnalyzerJobV2({ redis });
  const result = await slowAnalyzerJob.analyzeWebpagesChunked(userId, activityId, websiteUrl, {
    chunkSize: crawlV2Config.phase2ChunkSize,
  });

  try {
   let signatureStore = slowAnalyzerJob.duplicateProcessorV2._emptyStore(activityId);
    if (slowAnalyzerJob.duplicateProcessorV2.redis) {
      await slowAnalyzerJob.duplicateProcessorV2._clearRedisStore(signatureStore);
      logger.info("Redis store cleanup completed for duplicate processor", { activityId });
    }
  } catch (err) {
    logger.error("❌ Redis store cleanup failed for duplicate processor (non-fatal)", { err: err?.message });
  }

  try {
    await LinkProcessor.clearActivityLinkCache(redis, activityId);
  } catch (clearErr) {
    logger.warn("Link cache cleanup failed (non-fatal)", { activityId, err: clearErr?.message });
  }

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
