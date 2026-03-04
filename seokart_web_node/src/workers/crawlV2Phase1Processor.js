"use strict";

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { connect } = require("../config/database");
const { initEmitter, emitToUser } = require("../services/socket-emitter");
const { scraperService } = require("../services/scraper-service");
const SitemapService = require("../services/sitemap-service");
const FastScraperJob = require("../jobs/fast-scraper");
const { UserActivity } = require("../models/activity-models");
const crawlV2Phase2Queue = require("../queue/crawlV2Phase2Queue");
const crawlV2Config = require("../config/crawl-v2");
const logger = require("../config/logger");
const ValidationUtils = require("../utils/validation");

let initialized = false;

/**
 * Crawl V2 Phase1: sitemap fetch + URL extract + save to DB, then scrape URLs and save to DB.
 * Designed for 100K pages and high concurrency. On success, enqueues Phase2 (analysis).
 */
module.exports = async function (job) {
  if (!initialized) {
    await connect();
    await initEmitter();
    initialized = true;
    logger.info("Crawl V2 Phase1 worker initialized");
  }

  const { activityId, websiteUrl, sitemapUrls, userId, concurrency } = job.data;
  if (!activityId || !websiteUrl || !userId) {
    throw new Error(
      "Crawl V2 Phase1 job missing required data: activityId, websiteUrl, userId",
    );
  }


  const validConcurrency = Math.max(
    5,
    Math.min(50, parseInt(concurrency, 10) || 20),
  );
  let finalSitemapUrls = Array.isArray(sitemapUrls)
    ? sitemapUrls.filter((u) => u && String(u).trim())
    : [];

  logger.info(
    `Crawl V2 Phase1 job ${job.id} starting for activity ${activityId}`,
    userId,
  );

  // Normalize website URL
  const urlValidation = ValidationUtils.validateUrl(websiteUrl);
  if (!urlValidation.isValid) {
    throw new Error(urlValidation.errors?.[0] || "Invalid website URL");
  }
  let cleanUrl = urlValidation.normalizedUrl;
  if (cleanUrl.includes("://www."))
    cleanUrl = cleanUrl.replace("://www.", "://");

  if (!scraperService.initialized) {
    await scraperService.initialize();
  }

  // Resolve sitemap URLs if not provided
  if (finalSitemapUrls.length === 0) {
    const validation = await scraperService.validateWebsite(cleanUrl);
    if (!validation.isValid) {
      throw new Error(validation.message || "Website validation failed");
    }
    if (!validation.sitemapUrls || validation.sitemapUrls.length === 0) {
      throw new Error(
        "No sitemaps found. Please provide sitemap URLs manually.",
      );
    }
    finalSitemapUrls = validation.sitemapUrls;
  }

  const maxUrls = crawlV2Config.maxPagesPerCrawl;
  const sitemapService = new SitemapService();

  const sitemapResult = await sitemapService.processSitemapsAndSaveUrls(
    finalSitemapUrls.slice(0, crawlV2Config.maxSitemapUrls),
    activityId,
    userId,
    { maxUrls },
  );

  const allUrls = sitemapResult.extractedUrls;
  if (!allUrls || allUrls.length === 0) {
    throw new Error("No URLs found in sitemaps");
  }

  await UserActivity.findByIdAndUpdate(activityId, {
    sitemapCount:   finalSitemapUrls.length || 0,
    isSitemapCrawling: 0,
    isWebpageCrawling: 1,
  });

  logger.info(`Crawl V2 Phase1: scraping ${allUrls.length} URLs`, userId);

  const fastScraperJob = new FastScraperJob();
  const fastResults = await fastScraperJob.processWebpages(
    allUrls,
    userId,
    activityId,
    cleanUrl,
    { skipGrammarAndScores: true },
  );

  if (fastScraperJob.scraper.shouldStop || fastResults.stopped) {
    await UserActivity.findByIdAndUpdate(activityId, {
      status: "stopped",
      endTime: new Date(),
      progress: Math.round((fastResults.successful / allUrls.length) * 80),
      webpageCount: allUrls.length,
      webpagesSuccessful: fastResults.successful,
      webpagesFailed: fastResults.failed,
      isSitemapCrawling: 0,
      isWebpageCrawling: 0,
      fastScrapingCompleted: false,
      sitemapCount: finalSitemapUrls.length || 0,
      lastUpdated: new Date(),
      lastHeartbeat: new Date(),
    });

    emitToUser(userId, "crawl_phase1_completed", {
      activityId,
      websiteUrl: cleanUrl,
      status: "stopped",
      totalUrls: allUrls.length,
      successful: fastResults.successful,
      failed: fastResults.failed,
      stoppedByUser: true,
      phase2Queued: false,
      timestamp: new Date().toISOString(),
    });
    return {
      success: true,
      stopped: true,
      totalUrls: allUrls.length,
      phase2Queued: false,
    };
  }

  await UserActivity.findByIdAndUpdate(activityId, {
    status: "analyzing",
    progress: 85,
    webpageCount: allUrls.length,
    webpagesSuccessful: fastResults.successful,
    webpagesFailed: fastResults.failed,
    isSitemapCrawling: 0,
    sitemapCount: finalSitemapUrls.length || 0,
    isWebpageCrawling: 2,
    fastScrapingCompleted: true,
    lastUpdated: new Date(),
    lastHeartbeat: new Date(),
    fastScrapingResults: {
      totalUrls: allUrls.length,
      successful: fastResults.successful,
      failed: fastResults.failed,
      processingTime: fastResults.totalTime,
    },
    lastHeartbeat: new Date(),
  });

  await crawlV2Phase2Queue.add(
    "analysis",
    { activityId: String(activityId), userId, websiteUrl: cleanUrl },
    { jobId: `crawlV2_phase2_${activityId}`, removeOnComplete: true },
  );

  emitToUser(userId, "crawl_phase1_completed", {
    activityId,
    websiteUrl: cleanUrl,
    status: "analyzing",
    totalUrls: allUrls.length,
    successful: fastResults.successful,
    failed: fastResults.failed,
    phase2Queued: true,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    `Crawl V2 Phase1 job ${job.id} completed; Phase2 queued for activity ${activityId}`,
    userId,
  );

  return {
    success: true,
    totalUrls: allUrls.length,
    successful: fastResults.successful,
    failed: fastResults.failed,
    phase2Queued: true,
  };
};
