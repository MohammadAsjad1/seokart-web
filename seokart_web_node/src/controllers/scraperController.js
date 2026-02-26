const mongoose = require("mongoose");
const { scraperService } = require("../services/scraper-service");
const { UserActivity } = require("../models/activity-models");
const socketService = require("../services/socketService");
const mockSocketService = require("../services/mock-socket-service");
const ValidationUtils = require("../utils/validation");
const logger = require("../config/logger");
const {
  WebpageCore,
  WebpageContent,
  WebpageScores,
  WebpageTechnical,
  WebpageAnalysis,
  calculateSEOScore,
} = require("../models/webpage-models");
const crashRecoveryService = require("../services/crash-recovery-service");
const WebScraper = require("../core/scraper");
const ScoreCalculator = require("../processors/score-calculator");
const GrammarSpellChecker = require("../processors/grammar-spell-checker");
const DuplicateProcessor = require("../processors/duplicate-processor");
const LinkProcessor = require("../processors/link-processor");
const { UserPlan } = require("../models/userPlan");
const scrapeQueue = require("../queue/scrapeQueue");
const crypto = require("crypto");
const { emitToUser } = require("../services/socket-emitter");

const MAX_SITEMAP_URLS = 500;
const JOB_LOCK_DURATION_MS = 2 * 60 * 60 * 1000;

const webCrawler = async ({
  websiteUrl,
  sitemapUrls,
  userId,
  concurrency = 15,
  // concurrency = 5,
}) => {
  const startTime = Date.now();
  let userActivity = null;

  try {
    logger.info(`🚀 Background crawl init for: ${websiteUrl}`, userId);

    const urlValidation = ValidationUtils.validateUrl(websiteUrl);
    if (!urlValidation.isValid) {
      throw new Error(urlValidation.errors[0] || "Invalid website URL");
    }

    const validConcurrency = Math.max(
      5,
      Math.min(25, parseInt(concurrency) || 15)
    );

    let cleanUrl = urlValidation.normalizedUrl;
    if (cleanUrl.includes("://www.")) {
      cleanUrl = cleanUrl.replace("://www.", "://");
    }

    if (!scraperService.initialized) {
      await scraperService.initialize();
    }

    let finalSitemapUrls = sitemapUrls;

    if (!finalSitemapUrls || finalSitemapUrls.length === 0) {
      const validation = await scraperService.validateWebsite(cleanUrl);
      if (!validation.isValid) {
        throw new Error(validation.message || "Website validation failed");
      }

      if (!validation.sitemapUrls || validation.sitemapUrls.length === 0) {
        throw new Error(
          "No sitemaps found. Please provide sitemap URLs manually."
        );
      }

      finalSitemapUrls = validation.sitemapUrls;
    }

    let existingActivity = await UserActivity.findOne({
      userId,
      websiteUrl: cleanUrl,
    });

    // ADD - CHECK FOR STALLED/CRASHED ACTIVITIES
    if (
      existingActivity &&
      ["processing", "analyzing"].includes(existingActivity.status)
    ) {
      const timeSinceHeartbeat =
        Date.now() -
        (
          existingActivity.lastHeartbeat ||
          existingActivity.lastUpdated ||
          Date.now()
        ).getTime();

      // If stalled (no heartbeat for 30s), allow restart
      if (timeSinceHeartbeat > 30000 || existingActivity.isStalled) {
        logger.warn(
          `🔄 Found stalled activity, restarting: ${cleanUrl}`,
          userId
        );

        await UserActivity.findByIdAndUpdate(existingActivity._id, {
          status: "failed",
          endTime: new Date(),
          errorMessages: [
            ...(existingActivity.errorMessages || []),
            "Restarted after stall",
          ],
          isSitemapCrawling: 0,
          isWebpageCrawling: 0,
          isStalled: true,
        });

        existingActivity = null; // Allow new crawl
      } else {
        // Still active
        logger.info(
          `🔄 Active crawl already in progress for: ${cleanUrl}`,
          userId
        );
        return {
          success: false,
          message: "Website scraping is already in progress",
          status: existingActivity.status,
          activityId: existingActivity._id,
          progress: existingActivity.progress || 0,
          currentCrawlStarted: existingActivity.lastCrawlStarted,
          crawlCount: existingActivity.crawlCount || 1,
          isCurrentlyCrawling: true,
          sitemapCrawling: existingActivity.isSitemapCrawling === 1,
          webpageCrawling: existingActivity.isWebpageCrawling !== 0,
        };
      }
    }

    if (!existingActivity) {
      // this section for starting a new activity
      userActivity = new UserActivity({
        userId,
        websiteUrl: cleanUrl,
        status: "processing",
        startTime: new Date(),
        lastCrawlStarted: new Date(),
        lastHeartbeat: new Date(), // ADD
        progress: 0,
        crawlCount: 1,
        isSitemapCrawling: 1,
        isWebpageCrawling: 0,
        sitemapCount: finalSitemapUrls.length,
        webpageCount: 0,
        webpagesSuccessful: 0,
        webpagesFailed: 0,
        errorMessages: [],
        concurrency: validConcurrency,
        lastUpdated: new Date(),
        fastScrapingCompleted: false,
        slowAnalysisCompleted: false,
        serverInstance: crashRecoveryService.getInstanceId(), // ADD
        isStalled: false, // ADD
        crashRecovered: false, // ADD
      });
    } else {
      // this section for restarting a stalled activity
      userActivity = existingActivity;
      userActivity.status = "processing";
      userActivity.lastCrawlStarted = new Date();
      userActivity.lastHeartbeat = new Date(); // ADD
      userActivity.progress = 0;
      userActivity.crawlCount = (userActivity.crawlCount || 0) + 1;
      userActivity.isSitemapCrawling = 1;
      userActivity.isWebpageCrawling = 0;
      userActivity.sitemapCount = finalSitemapUrls.length;
      userActivity.webpageCount = 0;
      userActivity.webpagesSuccessful = 0;
      userActivity.webpagesFailed = 0;
      userActivity.errorMessages = [];
      userActivity.concurrency = validConcurrency;
      userActivity.endTime = undefined;
      userActivity.lastUpdated = new Date();
      userActivity.fastScrapingCompleted = false;
      userActivity.slowAnalysisCompleted = false;
      userActivity.serverInstance = crashRecoveryService.getInstanceId(); // ADD
      userActivity.isStalled = false; // ADD
      userActivity.crashRecovered = false; // ADD
    }

    await userActivity.save();

    const processingOptions = {
      concurrency: {
        fast_scraper: validConcurrency,
        slow_analyzer: Math.ceil(validConcurrency / 3),
        sitemap_processing: Math.min(3, validConcurrency),
      },
      timeouts: {
        request: 10000,
        sitemap: 15000,
      },
      realTimeUpdates: true,
    };

    // if (socketService.emitCrawlStarted) {
    //   socketService.emitCrawlStarted(userId, {
    //     activityId: userActivity._id,
    //     websiteUrl: cleanUrl,
    //     status: "processing",
    //     sitemapCount: finalSitemapUrls.length,
    //     crawlCount: userActivity.crawlCount,
    //     concurrency: validConcurrency,
    //     message: "Scraping started successfully",
    //     timestamp: new Date().toISOString(),
    //   });
    // }

    emitToUser(userId, "crawl_started", {
      activityId: userActivity._id,
      websiteUrl: cleanUrl,
      status: "processing",
      sitemapCount: finalSitemapUrls.length,
      crawlCount: userActivity.crawlCount,
      concurrency: validConcurrency,
      message: "Scraping started successfully",
      timestamp: new Date().toISOString(),
    });
    

    try {
      // Await the core scraping process. This keeps the Sandbox alive until the work is actually DONE.
      const result = await scraperService.processWebsite(
        finalSitemapUrls,
        userId,
        userActivity._id.toString(),
        cleanUrl,
        processingOptions
      );
    
      const wasStoppedByUser = result.stoppedByUser || false;
      const slowAnalysisPending = result.slowAnalysisPending === true;
      const finalStatus = wasStoppedByUser
        ? "stopped"
        : slowAnalysisPending
          ? "analyzing"
          : "completed";

      logger.info(
        wasStoppedByUser
          ? "🛑 Background processing stopped by user"
          : slowAnalysisPending
            ? "✅ Scraping completed; analysis queued (background job)"
            : "✅ Background processing completed",
        userId,
        {
          websiteUrl: cleanUrl,
          jobId: result.jobId,
          totalUrls: result.totalUrls,
          cleanedUp: result.cleanupResults?.updated || 0,
        }
      );

      const totalFailed = result.fastResults.failed + (result.cleanupResults?.updated || 0);
    
      // Update User Activity Record
      await UserActivity.findByIdAndUpdate(userActivity._id, {
        status: finalStatus,
        progress: wasStoppedByUser ? userActivity.progress : slowAnalysisPending ? 85 : 100,
        endTime: wasStoppedByUser || slowAnalysisPending ? undefined : new Date(),
        webpageCount: result.totalUrls,
        webpagesSuccessful: result.fastResults.successful,
        webpagesFailed: totalFailed,
        totalProcessingTime: result.processingTime,
        fastScrapingCompleted: !wasStoppedByUser,
        slowAnalysisCompleted: result.slowAnalysisCompleted || false,
        isSitemapCrawling: 0,
        isWebpageCrawling: slowAnalysisPending ? 2 : 0,
        lastUpdated: new Date(),
        lastHeartbeat: new Date(),
        fastScrapingResults: {
          totalUrls: result.totalUrls,
          successful: result.fastResults.successful,
          failed: result.fastResults.failed,
          incompleteMarkedFailed: result.cleanupResults?.updated || 0,
          processingTime: result.fastResults.totalTime,
        },
        slowAnalysisResults: result.slowResults
          ? {
              analyzed: result.slowResults.analyzed,
              updated: result.slowResults.updated,
              duplicatesFound: result.slowResults.duplicatesFound,
              brokenLinksFound: result.slowResults.brokenLinksFound,
              processingTime: result.slowResults.totalTime,
            }
          : null,
      });
    
      // Update user plan usage
      // try {
      //   const userPlan = await UserPlan.findOne({ userId });
      //   if (userPlan && result.totalUrls > 0) {
      //     console.log("Updating user plan usage: +", result.totalUrls, "pages for userId", userId);
      //     await userPlan.incrementUsage("webCrawler", "pages", result.totalUrls);
      //     logger.info(`User plan updated: +${result.totalUrls} pages for userId ${userId}`, userId);
      //   }
      // } catch (planErr) {
      //   logger.error("Failed to update user plan usage after crawl", planErr, userId);
      // }
    
      // Socket Emission for Completion
      emitToUser(userId, "crawl_completed", {
        activityId: userActivity._id,
        websiteUrl: cleanUrl,
        status: finalStatus,
        totalSitemaps: result.sitemaps,
        totalWebpages: result.totalUrls,
        savedPages: result.fastResults.successful,
        failedPages: totalFailed,
        incompletePages: result.cleanupResults?.updated || 0,
        processingTime: result.processingTime,
        message: wasStoppedByUser
          ? `Crawl stopped by user. ${result.cleanupResults?.updated || 0} incomplete pages marked as failed.`
          : slowAnalysisPending
            ? `Scraping done! Analysis (duplicates, links, scores) running in background.`
            : `Crawl completed! Processed ${result.fastResults.successful} pages successfully`,
        slowAnalysisCompleted: result.slowAnalysisCompleted,
        slowAnalysisPending: slowAnalysisPending || false,
        stoppedByUser: wasStoppedByUser,
        timestamp: new Date().toISOString(),
      });

      await emitUserActivitiesUpdate(userId);
    
    } catch (error) {
      // --- ERROR LOGIC (Previously .catch) ---
      const isRateLimited = error.message.includes("Rate limited");
      const finalStatus = isRateLimited ? "rate_limited" : "failed";
    
      logger.error("❌ Background processing failed", error, userId, {
        websiteUrl: cleanUrl,
        activityId: userActivity._id,
        isRateLimited,
      });
    
      // const WebpageService = require("../services/webpage-service");
      // const webpageService = new WebpageService();
      // const incompleteCount = await webpageService.getIncompleteWebpagesCount(userActivity._id);
      const incompleteCount = await scraperService.getIncompleteWebpagesCount(userActivity._id);
    
      if (incompleteCount > 0) {
        logger.warn(`${incompleteCount} incomplete pages were cleaned up during failure`, userId);
      }
    
      await UserActivity.findByIdAndUpdate(userActivity._id, {
        status: finalStatus,
        endTime: new Date(),
        errorMessages: [error.message],
        isSitemapCrawling: 0,
        isWebpageCrawling: 0,
        lastUpdated: new Date(),
        lastHeartbeat: new Date(),
      });
    
      // Socket Emission for Error
      emitToUser(userId, "crawl_error", {
        websiteUrl: cleanUrl,
        message: error.message,
        activityId: userActivity._id,
        isRateLimited,
        incompletePagesCleaned: incompleteCount,
        timestamp: new Date().toISOString(),
      });
    
      await emitUserActivitiesUpdate(userId);
      
      // CRITICAL: Re-throw the error so BullMQ knows the job failed
      throw error;
    }

    return {
      success: true,
      message: "Scraping started successfully",
      activityId: userActivity._id,
      status: "processing",
      websiteUrl: cleanUrl,
      sitemapCount: finalSitemapUrls.length,
      crawlCount: userActivity.crawlCount,
      lastCrawlStarted: userActivity.lastCrawlStarted,
      concurrency: validConcurrency,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error("❌ Error in webCrawler", error, userId, {
      websiteUrl,
      processingTime: Date.now() - startTime,
    });

    if (userActivity) {
      await UserActivity.findByIdAndUpdate(userActivity._id, {
        status: "failed",
        endTime: new Date(),
        errorMessages: [error.message],
        isSitemapCrawling: 0,
        isWebpageCrawling: 0,
        lastUpdated: new Date(),
      });

      await emitUserActivitiesUpdate(userId);
    }

    throw new Error(error.message);
  }
};

const handleStopCrawl = async (req, res) => {
  try {
    const { activityId } = req.body;
    const userId = req.user.id;

    console.log(`🛑 Stop crawl request received:`);
    console.log(`   - activityId: ${activityId}`);
    console.log(`   - userId: ${userId}`);
    console.log(`   - activityId type: ${typeof activityId}`);

    if (!activityId) {
      return res.status(400).json({
        success: false,
        message: "Activity ID is required",
      });
    }

    logger.info(
      `Stop request received for activity ${activityId} by user ${userId}`
    );

    const result = await scraperService.stopCrawl(activityId);

    console.log(`✅ Stop crawl result:`, result);

    res.status(200).json(result);
  } catch (error) {
    console.error(`❌ Stop crawl controller error:`, error);
    logger.error(`Stop crawl error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const handleSitemapCrawl = async (req, res) => {
  try {
    let { websiteUrl, sitemapUrls, concurrency } = req.body;
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userPlan = await UserPlan.findOne({ userId }).select("webCrawler domains").lean();
    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: "User plan not found",
      });
    }

    const limits = userPlan?.webCrawler?.limits || { pagesPerMonth: 100 };
    const usage = userPlan?.webCrawler?.usage || { pagesThisMonth: 0 };
    if (usage.pagesThisMonth >= limits.pagesPerMonth) {
      return res.status(400).json({
        success: false,
        message: "You have reached the maximum number of pages per month",
      });
    }

    if (websiteUrl) {
      websiteUrl = websiteUrl.trim();
      websiteUrl = websiteUrl.replace(/^(https?:\/\/)?(www\.)?/, "");
      websiteUrl = `https://${websiteUrl}`;
    }

    if (sitemapUrls && Array.isArray(sitemapUrls)) {
      sitemapUrls = sitemapUrls
        .filter((url) => url && url.trim())
        .map((url) => url.trim())
        .slice(0, MAX_SITEMAP_URLS);
    }

    const normalizedUrl = websiteUrl || "";
    const siteHash = crypto.createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 16);
    const jobId = `crawl_${userId}_${siteHash}`;

    const existingJob = await scrapeQueue.getJob(jobId).catch(() => null);
    if (existingJob) {
      const state = await existingJob.getState();
      if (["waiting", "delayed", "active"].includes(state)) {
        return res.status(200).json({
          success: true,
          message: "Crawl already queued for this website",
          jobId,
        });
      }

      await existingJob.remove();
    }

    const jobData = { websiteUrl, sitemapUrls, userId, concurrency };
    const jobOpts = {
      jobId,
      removeOnComplete: true,
      lockDuration: JOB_LOCK_DURATION_MS,
    };

    const job = await scrapeQueue.add("scrapeQueue", jobData, jobOpts);
    res.status(200).json({ success: true, message: "Crawl Started", jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const handleSingleUrlCrawl = async (req, res) => {
  try {
    const { websiteUrl, pageUrl } = req.body;
    const userId = req.user.id; // Get userId from authenticated user

    // Validate required fields
    if (!websiteUrl || !pageUrl || !userId) {
      return res.status(400).json({
        success: false,
        message: "websiteUrl, pageUrl, and userId are required",
      });
    }

    const userPlan = await UserPlan.findOne({ userId }).select("webCrawler").lean();
    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: "User plan not found",
      });
    }

    if (userPlan.webCrawler.usage.pagesThisMonth >= userPlan.webCrawler.limits.pagesPerMonth) {
      return res.status(400).json({
        success: false,
        message: "You have reached the maximum number of pages per month",
      });
    }

    // Initialize processors
    const duplicateProcessor = new DuplicateProcessor();
    const linkProcessor = new LinkProcessor();
    const scoreCalculator = new ScoreCalculator();
    const grammarChecker = new GrammarSpellChecker();
    const webScraper = new WebScraper();

    // Find existing webpage record
    let webpageCore = await WebpageCore.findOne({
      userId,
      pageUrl,
      websiteUrl,
    });

    if (!webpageCore) {
      return res.status(404).json({
        success: false,
        message: "Webpage not found in database",
      });
    }

    console.log(`Starting crawl for: ${pageUrl}`);

    // Scrape the webpage
    console.time("scrapeWebpage");
    const scrapedData = await webScraper.scrapeWebpage(pageUrl);
    console.timeEnd("scrapeWebpage");

    if (!scrapedData || scrapedData.error) {
      // Update webpage with error status
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        hasErrors: true,
        lastCrawled: new Date(),
        statusCode: scrapedData?.statusCode || 500,
      });

      return res.status(500).json({
        success: false,
        message: scrapedData?.error || "Failed to scrape webpage",
      });
    } else {
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        isProcessed: false,
      });
    }

    // Process grammar and spelling
    console.log("Checking grammar and spelling...");
    const grammarSpellIssues = await grammarChecker.checkContent(
      scrapedData.content,
      scrapedData.title,
      scrapedData.metaDescription
    );

    // Calculate SEO scores using the new system
    console.log("Calculating SEO scores...");
    const scoreResult = scoreCalculator.calculateNewSystemScores({
      ...scrapedData,
      grammarSpelling: grammarSpellIssues,
      duplicates: {},
      brokenLinks: [],
    });

    // Process links and get broken links
    console.log("Processing links...");
    console.time("validatePageLinks");
    const linkResults = await linkProcessor.validatePageLinks(webpageCore);
    console.timeEnd("validatePageLinks");


    // Get all webpages for duplicate detection
    // console.log("Finding duplicates...");
    // const allWebpages = await WebpageCore.find({
    //   userId,
    //   websiteUrl,
    // }).populate(["contentId", "scoresId", "technicalId", "analysisId"]);

    // Prepare current webpage data for duplicate detection
    const currentWebpageData = {
      pageUrl,
      title: scrapedData.title,
      metaDescription: scrapedData.metaDescription,
      content: scrapedData.content,
      wordCount: scrapedData.wordCount,
    };

    const duplicateResults = await duplicateProcessor.findDuplicates(
      [currentWebpageData],
      userId,
      websiteUrl
    );

    // Recalculate scores with complete data including duplicates and broken links
    const finalScoreResult = scoreCalculator.calculateNewSystemScores({
      ...scrapedData,
      grammarSpelling: grammarSpellIssues,
      duplicates: duplicateResults,
      noHttpLinks: linkResults.noHttpLinks,
      internalBrokenLinks: linkResults.internalBrokenLinks,
      externalBrokenLinks: linkResults.externalBrokenLinks,
      noRedirectLinks: linkResults.redirectLinks,
    });


    // Update WebpageCore
    const updatedCore = await WebpageCore.findByIdAndUpdate(
      webpageCore._id,
      {
        statusCode: scrapedData.statusCode || 200,
        lastCrawled: new Date(),
        scrapedAt: new Date(),
        seoScore: finalScoreResult.totalScore,
        seoGrade: finalScoreResult.grade,
        responseTime: scrapedData.responseTime || 0,
        hasErrors: false,
        isProcessed: true,
        processedAt: new Date(),
        slowAnalysisCompleted: true,
      },
      { new: true }
    );

    // Update or create WebpageContent
    const contentData = {
      webpageCoreId: webpageCore._id,
      title: scrapedData.title || "",
      titleLength: (scrapedData.title || "").length,
      titleMissing: !scrapedData.title,
      titleRightLength: !!(
        scrapedData.title &&
        scrapedData.title.length >= 30 &&
        scrapedData.title.length <= 60
      ),
      titleDuplicated: duplicateResults.titleDuplicates?.length > 0,
      metaDescription: scrapedData.metaDescription || "",
      metaDescriptionLength: (scrapedData.metaDescription || "").length,
      metaDescriptionMissing: !scrapedData.metaDescription,
      metaDescriptionRightLength: !!(
        scrapedData.metaDescription &&
        scrapedData.metaDescription.length >= 120 &&
        scrapedData.metaDescription.length <= 160
      ),
      metaDescriptionDuplicated:
        duplicateResults.descriptionDuplicates?.length > 0,
      content: scrapedData.content || "",
      wordCount: scrapedData.wordCount || 0,
      contentTooShort: (scrapedData.wordCount || 0) < 300,
      multipleTitles: (scrapedData.titleTagCount || 0) > 1,
      titleTagCount: scrapedData.titleTagCount || 0,
      headingStructure: scrapedData.headingStructure || {
        h1Count: 0,
        h2Count: 0,
        h3Count: 0,
        h4Count: 0,
        h5Count: 0,
        h6Count: 0,
        h1Text: "",
        h2Texts: [],
      },
      oneH1Only: (scrapedData.headingStructure?.h1Count || 0) === 1,
      headingsProperOrder:
        scoreCalculator.checkHeadingsProperOrder({
          headingStructure: scrapedData.headingStructure,
        }) === 5,

      urlTooLong: pageUrl.length > 100, // Using consistent URL length check
      urlLength: pageUrl.length,
    };

    let webpageContent;
    if (webpageCore.contentId) {
      webpageContent = await WebpageContent.findByIdAndUpdate(
        webpageCore.contentId,
        contentData,
        { new: true }
      );
    } else {
      webpageContent = await WebpageContent.create(contentData);
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        contentId: webpageContent._id,
      });
    }

    // Update or create WebpageScores
    const scoresData = {
      webpageCoreId: webpageCore._id,
      seoScore: finalScoreResult.totalScore,
      seoGrade: finalScoreResult.grade,
      scores: finalScoreResult.scores,
      lastCalculated: new Date(),
      calculationVersion: "3.0",
    };

    let webpageScores;
    if (webpageCore.scoresId) {
      webpageScores = await WebpageScores.findByIdAndUpdate(
        webpageCore.scoresId,
        scoresData,
        { new: true }
      );
    } else {
      webpageScores = await WebpageScores.create(scoresData);
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        scoresId: webpageScores._id,
      });
    }

    // Update or create WebpageTechnical
    const technicalData = {
      webpageCoreId: webpageCore._id,
      technicalSeo: scrapedData.technicalSeo || {
        canonicalTagExists: false,
        canonicalUrl: "",
        robotsDirectives: "",
        hreflangTags: [],
        structuredData: false,
        hasViewport: false,
        hasCharset: false,
      },
      links: {
        totalCount: scrapedData.links?.totalCount || 0,
        internalCount: scrapedData.links?.internalCount || 0,
        externalCount: scrapedData.links?.externalCount || 0,
        internalBrokenLinksCount: linkResults.internalBrokenLinks.length,
        externalBrokenLinksCount: linkResults.externalBrokenLinks.length,
        redirectLinksCount: linkResults.redirectLinks.length, // NEW
        httpLinksCount: scrapedData.links?.httpLinksCount || 0,
        httpsLinksCount: scrapedData.links?.httpsLinksCount || 0,
      },
      internalBrokenLinks: linkResults.internalBrokenLinks || [], // NEW
      externalBrokenLinks: linkResults.externalBrokenLinks || [], // NEW
      redirectLinks: linkResults.redirectLinks || [], // NEW
      performance: scrapedData.performance || {
        mobileResponsive: false,
        hasViewportMeta: false,
        hasMediaQueries: false,
        isResponsiveDesign: false,
        pageSize: 0,
        webVitals: { LCP: 0, FID: 0, CLS: 0 },
      },
    };

    let webpageTechnical;
    if (webpageCore.technicalId) {
      webpageTechnical = await WebpageTechnical.findByIdAndUpdate(
        webpageCore.technicalId,
        technicalData,
        { new: true }
      );
    } else {
      webpageTechnical = await WebpageTechnical.create(technicalData);
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        technicalId: webpageTechnical._id,
      });
    }

    const analysisData = {
      webpageCoreId: webpageCore._id,
      images: {
        totalCount: scrapedData.images?.totalCount || 0,
        withAlt: scrapedData.images?.withAlt || 0,
        withTitle: scrapedData.images?.withTitle || 0,
        altMissingCount: scrapedData.images?.altMissingCount || 0,
        altTextPercentage: scrapedData.images?.altTextPercentage || 0,
      },
      duplicates: {
        titleDuplicates: duplicateResults.titleDuplicates || [],
        descriptionDuplicates: duplicateResults.descriptionDuplicates || [],
        contentDuplicates: duplicateResults.contentDuplicates || [],
      },
      contentQuality: {
        spellingErrors: grammarSpellIssues.spellingErrors || [],
        spellingErrorsCount: grammarSpellIssues.spellingErrorsCount || 0,
        grammarErrors: grammarSpellIssues.grammarErrors || [],
        grammarErrorsCount: grammarSpellIssues.grammarErrorsCount || 0,
        totalLanguageErrors: grammarSpellIssues.totalLanguageErrors || 0,
      },
      slowAnalysisCompleted: true,
      analysisVersion: "3.0",
    };

    let webpageAnalysis;
    if (webpageCore.analysisId) {
      webpageAnalysis = await WebpageAnalysis.findByIdAndUpdate(
        webpageCore.analysisId,
        analysisData,
        { new: true }
      );
    } else {
      webpageAnalysis = await WebpageAnalysis.create(analysisData);
      await WebpageCore.findByIdAndUpdate(webpageCore._id, {
        analysisId: webpageAnalysis._id,
      });
    }

    console.log(
      `Successfully updated webpage: ${pageUrl} with SEO score: ${finalScoreResult.totalScore}`
    );

    await WebpageCore.findByIdAndUpdate(webpageCore._id, {
      isProcessed: true,
    });

    // Update user plan usage (1 page crawled)
    try {
      const userPlan = await UserPlan.findOne({ userId });
      if (userPlan) {
        await userPlan.incrementUsage("webCrawler", "pages", 1);
      }
    } catch (planErr) {
      logger.error("Failed to update user plan usage for single URL crawl", planErr, userId);
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: "Webpage successfully crawled and updated",
      data: {
        pageUrl,
        seoScore: finalScoreResult.totalScore,
        seoGrade: finalScoreResult.grade,
        // lastCrawled: updatedCore.lastCrawled
        issues: {
          grammarSpelling: grammarSpellIssues.totalLanguageErrors || 0,
          internalBrokenLinks: linkResults.internalBrokenLinks.length, // CHANGED
          externalBrokenLinks: linkResults.externalBrokenLinks.length, // CHANGED
          redirectLinks: linkResults.redirectLinks.length, // NEW
          duplicates: {
            titles: duplicateResults.titleDuplicates?.length || 0,
            descriptions: duplicateResults.descriptionDuplicates?.length || 0,
            content: duplicateResults.contentDuplicates?.length || 0,
          },
        },
        linkDetails: {
          // NEW SECTION
          internalBrokenLinks: linkResults.internalBrokenLinks,
          externalBrokenLinks: linkResults.externalBrokenLinks,
          redirectLinks: linkResults.redirectLinks,
        },
        scores: finalScoreResult.scores,
        breakdown: finalScoreResult.breakdown,
      },
    });
  } catch (error) {
    console.error("Error in handleSingleUrlCrawl:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while crawling webpage",
      error: error.message,
    });
  }
};

const checkCrawlStatus = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user.id;

    // Validate inputs
    if (!activityId || !mongoose.Types.ObjectId.isValid(activityId)) {
      return res.status(400).json({
        success: false,
        message: "Valid activity ID is required",
      });
    }

    const activity = await UserActivity.findOne({
      _id: activityId,
      userId,
    });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found",
      });
    }

    // Calculate real-time metrics
    const currentTime = Date.now();
    const startTime = activity.startTime
      ? activity.startTime.getTime()
      : currentTime;
    const elapsedTime = currentTime - startTime;
    const estimatedTimeRemaining = calculateEstimatedTime(activity);
    const processingSpeed = calculateProcessingSpeed(activity);

    // Get detailed phase information
    const phaseInfo = getDetailedPhaseInfo(activity);

    return res.status(200).json({
      success: true,
      activityId: activity._id,
      status: activity.status,
      progress: activity.progress || 0,
      phaseInfo,
      isSitemapCrawling: activity.isSitemapCrawling,
      isWebpageCrawling: activity.isWebpageCrawling,
      sitemapCount: activity.sitemapCount || 0,
      webpageCount: activity.webpageCount || 0,
      webpagesSuccessful: activity.webpagesSuccessful || 0,
      webpagesFailed: activity.webpagesFailed || 0,
      fastScrapingCompleted: activity.fastScrapingCompleted || false,
      slowAnalysisCompleted: activity.slowAnalysisCompleted || false,
      startTime: activity.startTime,
      endTime: activity.endTime,
      lastUpdated: activity.lastUpdated,
      errorMessages: activity.errorMessages || [],

      elapsedTime,
      estimatedTimeRemaining,
      processingSpeed,
      successRate: calculateSuccessRate(activity),

      metadata: {
        concurrency: activity.concurrency,
        crawlCount: activity.crawlCount,
        websiteUrl: activity.websiteUrl,
        lastUpdate: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("❌ Error in checkCrawlStatus", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while checking status",
      error: error.message,
    });
  }
};

const getUserActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status = null,
      websiteUrl = null,
      sortBy = "lastCrawlStarted",
      sortOrder = "desc",
    } = req.query;

    // Validate pagination
    const pagination = ValidationUtils.validatePagination(page, limit);
    if (!pagination.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination parameters",
        errors: pagination.errors,
      });
    }

    // Build filter
    const filter = { userId };
    if (status) filter.status = status;
    if (websiteUrl) filter.websiteUrl = new RegExp(websiteUrl, "i");

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Calculate skip
    const skip = (pagination.page - 1) * pagination.limit;

    // Execute queries in parallel
    const [userActivities, totalCount] = await Promise.all([
      UserActivity.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(pagination.limit)
        .lean(),
      UserActivity.countDocuments(filter),
    ]);

    if (!userActivities || userActivities.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No activities found for this user",
        count: 0,
        totalCount: 0,
        data: [],
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      });
    }

    // Enhance activities with real-time data
    const enhancedActivities = userActivities.map((activity) => ({
      ...activity,
      estimatedTimeRemaining: calculateEstimatedTime(activity),
      processingSpeed: calculateProcessingSpeed(activity),
      successRate: calculateSuccessRate(activity),
      isActive: ["processing", "analyzing"].includes(activity.status),
      phaseDescription: getPhaseDescription(activity),
      detailedPhase: getDetailedPhaseInfo(activity),
    }));

    const totalPages = Math.ceil(totalCount / pagination.limit);

    return res.status(200).json({
      success: true,
      count: userActivities.length,
      totalCount,
      data: enhancedActivities,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
      },
      filters: { status, websiteUrl, sortBy, sortOrder },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("❌ Error fetching user activities", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Enhanced webpage data getter with better filtering
const getWebpageData = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      sortBy = "seoScore",
      sortOrder = "desc",
      minScore = null,
      maxScore = null,
      hasIssues = null,
    } = req.query;

    // Validate activity ID
    if (!activityId || !mongoose.Types.ObjectId.isValid(activityId)) {
      return res.status(400).json({
        success: false,
        message: "Valid activity ID is required",
      });
    }

    // Check if activity belongs to user
    const activity = await UserActivity.findOne({ _id: activityId, userId });
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found",
      });
    }

    // Build filter for webpages
    const webpageFilter = { userActivityId: activityId };

    if (minScore !== null) {
      webpageFilter.seoScore = { $gte: parseFloat(minScore) };
    }
    if (maxScore !== null) {
      webpageFilter.seoScore = {
        ...webpageFilter.seoScore,
        $lte: parseFloat(maxScore),
      };
    }
    if (hasIssues === "true") {
      webpageFilter.$or = [
        { "duplicates.titleDuplicates.0": { $exists: true } },
        { "duplicates.descriptionDuplicates.0": { $exists: true } },
        { "duplicates.contentDuplicates.0": { $exists: true } },
        { "brokenLinks.0": { $exists: true } },
        { "grammarSpelling.hasSpellingErrors": true },
        { "grammarSpelling.hasGrammarErrors": true },
      ];
    }

    // Get webpage data with enhanced filtering
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    const [webpages, totalCount] = await Promise.all([
      WebpageCore.find(webpageFilter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WebpageCore.countDocuments(webpageFilter),
    ]);

    return res.status(200).json({
      success: true,
      data: webpages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        hasNext: skip + parseInt(limit) < totalCount,
        hasPrev: parseInt(page) > 1,
      },
      activitySummary: {
        activityId: activity._id,
        websiteUrl: activity.websiteUrl,
        status: activity.status,
        totalWebpages: activity.webpageCount || 0,
        successfulPages: activity.webpagesSuccessful || 0,
        failedPages: activity.webpagesFailed || 0,
        fastScrapingCompleted: activity.fastScrapingCompleted || false,
        slowAnalysisCompleted: activity.slowAnalysisCompleted || false,
        lastUpdated: activity.lastUpdated,
      },
      filters: { minScore, maxScore, hasIssues, sortBy, sortOrder },
    });
  } catch (error) {
    logger.error("❌ Error fetching webpage data", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching webpage data",
      error: error.message,
    });
  }
};

// Helper functions

const stopActiveCrawl = async (activityId, userId) => {
  try {
    const activity = await UserActivity.findOneAndUpdate(
      { _id: activityId, userId },
      {
        status: "stopped",
        endTime: new Date(),
        isSitemapCrawling: 0,
        isWebpageCrawling: 0,
        lastUpdated: new Date(),
      },
      { new: true }
    );

    if (activity) {
      socketService.emitError(userId, {
        activityId,
        websiteUrl: activity.websiteUrl,
        message: "Crawl stopped by force recrawl request",
        reason: "force_stop",
      });
    }

    return activity;
  } catch (error) {
    logger.error("❌ Error stopping active crawl", error);
    throw error;
  }
};

const emitActivityStatus = (userId, activity, message) => {
  socketService.emitActivityUpdate(userId, {
    activityId: activity._id,
    websiteUrl: activity.websiteUrl,
    status: activity.status,
    progress: activity.progress || 0,
    isSitemapCrawling: activity.isSitemapCrawling,
    isWebpageCrawling: activity.isWebpageCrawling,
    sitemapCount: activity.sitemapCount || 0,
    webpageCount: activity.webpageCount || 0,
    webpagesSuccessful: activity.webpagesSuccessful || 0,
    webpagesFailed: activity.webpagesFailed || 0,
    message,
    estimatedTimeRemaining: calculateEstimatedTime(activity),
    lastUpdated: activity.lastUpdated,
  });
};

const emitUserActivitiesUpdate = async (userId) => {
  try {
    const activities = await UserActivity.find({ userId })
      .sort({ lastCrawlStarted: -1 })
      .limit(20)
      .lean();

    // if (socketService && socketService.emitUserActivitiesUpdate) {
    //   socketService.emitUserActivitiesUpdate(userId, activities);
    // }
    emitToUser(userId, "user_activities_update", {
      timestamp: new Date().toISOString(),
      success: true,
      count: activities.length,
      data: activities,
    });
  } catch (error) {
    logger.error("Error emitting user activities update", error, userId);
  }
};

const getPhaseDescription = (activity) => {
  if (activity.isSitemapCrawling === 1) return "Processing sitemaps";
  if (activity.isWebpageCrawling === 1) return "Fast scraping webpages";
  if (activity.isWebpageCrawling === 2) return "Analyzing content details";
  if (activity.status === "completed") return "Completed successfully";
  if (activity.status === "failed") return "Processing failed";
  return "Processing";
};

const getDetailedPhaseInfo = (activity) => {
  return {
    currentPhase: getPhaseDescription(activity),
    phases: {
      sitemapProcessing: {
        completed: activity.isSitemapCrawling === 0,
        active: activity.isSitemapCrawling === 1,
        progress:
          activity.isSitemapCrawling === 1
            ? 10
            : activity.progress > 10
              ? 100
              : 0,
      },
      fastScraping: {
        completed: activity.fastScrapingCompleted || false,
        active: activity.isWebpageCrawling === 1,
        progress:
          activity.isWebpageCrawling === 1
            ? activity.progress
            : activity.fastScrapingCompleted
              ? 100
              : 0,
      },
      slowAnalysis: {
        completed: activity.slowAnalysisCompleted || false,
        active: activity.isWebpageCrawling === 2,
        progress:
          activity.isWebpageCrawling === 2
            ? activity.progress
            : activity.slowAnalysisCompleted
              ? 100
              : 0,
      },
    },
  };
};

// Utility functions
const estimateWebpageCount = (sitemapCount) => {
  return sitemapCount * 300; // Conservative estimate
};

const calculateEstimatedTime = (activity) => {
  if (
    !activity ||
    ["completed", "failed", "stopped"].includes(activity.status)
  ) {
    return 0;
  }

  const progress = activity.progress || 0;
  if (progress <= 0) return 0;

  const startTime = activity.startTime
    ? activity.startTime.getTime()
    : Date.now();
  const elapsed = Date.now() - startTime;
  const totalEstimated = (elapsed / progress) * 100;

  return Math.max(0, Math.round(totalEstimated - elapsed));
};

const calculateProcessingSpeed = (activity) => {
  if (!activity || !activity.startTime) return 0;

  const elapsed = Date.now() - activity.startTime.getTime();
  const processed =
    (activity.webpagesSuccessful || 0) + (activity.webpagesFailed || 0);

  if (elapsed <= 0) return 0;

  return Math.round((processed / (elapsed / 1000)) * 60); // pages per minute
};

const calculateSuccessRate = (activity) => {
  if (!activity) return 0;

  const successful = activity.webpagesSuccessful || 0;
  const total = successful + (activity.webpagesFailed || 0);

  if (total <= 0) return 0;

  return Math.round((successful / total) * 100);
};

const determineErrorCode = (error) => {
  if (error.message.includes("timeout")) return "TIMEOUT_ERROR";
  if (error.message.includes("rate limit")) return "RATE_LIMIT_ERROR";
  if (error.message.includes("validation")) return "VALIDATION_ERROR";
  if (error.message.includes("network")) return "NETWORK_ERROR";
  if (error.message.includes("cloudflare")) return "CLOUDFLARE_ERROR";
  return "UNKNOWN_ERROR";
};

// Socket service initialization with enhanced real-time updates
const initializeSocket = (io) => {
  try {
    // Initialize socket service
    if (socketService && typeof socketService.init === "function") {
      socketService.init(io);
      logger.info("🔌 Real socket service initialized in scraper controller");
    } else {
      logger.warn("🔌 Real socket service not available, using mock service");
    }

    // Also initialize scraper service with socket capability
    if (
      scraperService &&
      typeof scraperService.initializeSocket === "function"
    ) {
      scraperService.initializeSocket(io || mockSocketService);
    }

    const actualSocketService = io || mockSocketService;

    actualSocketService.on &&
      actualSocketService.on("connection", (socket) => {
        const userId = socket.userId;

        if (userId && socket.isAuthenticated) {
          // Add user to mock service if using it
          if (!io && mockSocketService) {
            mockSocketService.addUser(userId);
          }

          socket.on("request_activity_update", async (activityId) => {
            try {
              if (!mongoose.Types.ObjectId.isValid(activityId)) return;

              const activity = await UserActivity.findOne({
                _id: activityId,
                userId,
              });
              if (activity) {
                emitActivityStatus(userId, activity, "Requested update");
              }
            } catch (error) {
              logger.error("Error handling activity update request", error);
            }
          });

          socket.on("request_real_time_stats", async (activityId) => {
            try {
              if (!mongoose.Types.ObjectId.isValid(activityId)) return;

              const activity = await UserActivity.findOne({
                _id: activityId,
                userId,
              });
              if (activity) {
                const realTimeStats = {
                  activityId: activity._id,
                  progress: activity.progress || 0,
                  processingSpeed: calculateProcessingSpeed(activity),
                  estimatedTimeRemaining: calculateEstimatedTime(activity),
                  successRate: calculateSuccessRate(activity),
                  lastUpdated: activity.lastUpdated,
                  detailedPhase: getDetailedPhaseInfo(activity),
                };

                socket.emit && socket.emit("real_time_stats", realTimeStats);
              }
            } catch (error) {
              logger.error("Error handling real-time stats request", error);
            }
          });

          socket.on("disconnect", () => {
            if (!io && mockSocketService) {
              mockSocketService.removeUser(userId);
            }
          });
        }
      });

    logger.info("🔌 Socket service handlers initialized");
  } catch (error) {
    logger.error("🔌 Error initializing socket service", error);
  }
};

module.exports = {
  handleStopCrawl,
  handleSitemapCrawl,
  handleSingleUrlCrawl,
  checkCrawlStatus,
  getUserActivities,
  getWebpageData,
  initializeSocket,
  calculateEstimatedTime,
  calculateProcessingSpeed,
  calculateSuccessRate,
  webCrawler,
  emitUserActivitiesUpdate,
};
