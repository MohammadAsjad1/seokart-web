const WebScraper = require("../core/scraper");
const ScoreCalculator = require("../processors/score-calculator");
const GrammarSpellChecker = require("../processors/grammar-spell-checker");
const WebpageService = require("../services/webpage-service");
const ActivityService = require("../services/activity-service");
const config = require("../config/scraper");
const logger = require("../config/logger");
const axios = require("axios");
const {scraperService} = require("../services/scraper-service");

const scraper = new WebScraper();

class FastScraperJob {
  constructor() {
    this.scraper = new WebScraper();
    this.scoreCalculator = new ScoreCalculator();
    this.grammarChecker = new GrammarSpellChecker();
    this.webpageService = new WebpageService();
    this.activityService = new ActivityService();

    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      startTime: null,
      batches_completed: 0,
    };
  }

  async processWebpages(urls, userId, userActivityId, websiteUrl, options = {}) {
    this.stats.startTime = Date.now();
    this.resetStats();

    const skipGrammarAndScores = options.skipGrammarAndScores === true;
    logger.info(
      `Starting fast scraping for ${urls.length} URLs${skipGrammarAndScores ? " (fast: no grammar/scores)" : ""}`,
      userId
    );

    const batchSize = config.batch_sizes.fast_scrape;
    const totalBatches = Math.ceil(urls.length / batchSize);

    try {
      for (let i = 0; i < urls.length; i += batchSize) {
        // Check if scraping should stop (in-process signal)
        if (this.scraper.shouldStop) {
          logger.warn(
            "Scraping stopped - cleaning up incomplete webpages",
            userId
          );
          await this.cleanupIncompleteWebpages(userActivityId, userId);
          break;
        }
        // Check DB for stop requested from another process (e.g. stop crawl API)
        const activity = await this.activityService.getActivity(userActivityId);
        if (activity?.status === "stopped") {
          logger.warn("Stop requested via DB - stopping scrape", userId);
          this.scraper.stopScraping();
          await this.cleanupIncompleteWebpages(userActivityId, userId);
          break;
        }

        const batch = urls.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        logger.debug(
          `Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`,
          userId
        );

        const batchResults = await this.processBatch(
          batch,
          userId,
          userActivityId,
          websiteUrl,
          options
        );

        this.stats.successful += batchResults.successful;
        this.stats.failed += batchResults.failed;
        this.stats.processed += batch.length;
        this.stats.batches_completed++;

        const progressPercent = Math.round(
          (this.stats.processed / urls.length) * 80
        );

        await this.activityService.updateProgress(userActivityId, {
          progress: progressPercent,
          webpageCount: this.stats.processed,
          webpagesSuccessful: this.stats.successful,
          webpagesFailed: this.stats.failed,
          isWebpageCrawling: 1,
          isSitemapCrawling: 0,
        });

        logger.debug(
          `Batch ${batchNumber}/${totalBatches} completed: ${batchResults.successful}/${batch.length} successful`,
          userId
        );
        console.log(`Batch ${batchNumber}/${totalBatches} completed: ${batchResults.successful}/${batch.length} successful`);

        if (i + batchSize < urls.length) {
          const batchDelay = config.batch_delays?.fast_scraper ?? 50;
          await this.sleep(batchDelay);
        }
      }

      // Check if stopped before marking as complete
      if (this.scraper.shouldStop) {
        await this.activityService.updateProgress(userActivityId, {
          progress: Math.round((this.stats.processed / urls.length) * 80),
          webpageCount: this.stats.processed,
          webpagesSuccessful: this.stats.successful,
          webpagesFailed: this.stats.failed,
          fastScrapingCompleted: false,
          isWebpageCrawling: 0,
        });

        logger.info(
          `Fast scraping stopped: ${this.stats.successful}/${urls.length} successful, ${this.stats.failed} failed`,
          userId
        );

        return {
          successful: this.stats.successful,
          failed: this.stats.failed,
          total: urls.length,
          stopped: true,
        };
      }

      await this.activityService.updateProgress(userActivityId, {
        progress: 85,
        webpageCount: this.stats.processed,
        webpagesSuccessful: this.stats.successful,
        webpagesFailed: this.stats.failed,
        fastScrapingCompleted: true,
        isWebpageCrawling: 0,
      });

      const totalTime = Date.now() - this.stats.startTime;
      const avgTimePerUrl = totalTime / urls.length;

      logger.info(
        `Fast scraping completed: ${this.stats.successful}/${
          urls.length
        } successful (${avgTimePerUrl.toFixed(0)}ms/URL)`,
        userId
      );

      return {
        successful: this.stats.successful,
        failed: this.stats.failed,
        total: urls.length,
        avgTime: avgTimePerUrl,
        totalTime,
      };
    } catch (error) {
      logger.error("Error in processWebpages", error, userId);
      // Cleanup incomplete webpages on error
      await this.cleanupIncompleteWebpages(userActivityId, userId);
      throw error;
    }
  }

  async cleanupIncompleteWebpages(userActivityId, userId) {
    try {
      logger.info(
        `Cleaning up incomplete webpages for activity ${userActivityId}`,
        userId
      );

      // Find all webpages that were created but not fully processed
      // const incompleteWebpages =
      //   await this.webpageService.findIncompleteWebpages(userActivityId);
      const incompleteWebpages = await scraperService.findIncompleteWebpages(userActivityId);
      if (!incompleteWebpages || incompleteWebpages.length === 0) {
        logger.info("No incomplete webpages found", userId);
        return { updated: 0 };
      }

      logger.info(
        `Found ${incompleteWebpages.length} incomplete webpages to mark as failed`,
        userId
      );

      // Mark all incomplete pages as failed
      // const updateResult = await this.webpageService.markWebpagesAsFailed(
      //   userActivityId,
      //   "Scraping stopped before completion"
      // );
      const updateResult = await scraperService.markWebpagesAsFailed(
        userActivityId,
        "Scraping stopped before completion"
      );

      logger.info(
        `Marked ${updateResult.modifiedCount} webpages as failed`,
        userId
      );

      return {
        updated: updateResult.modifiedCount,
        found: incompleteWebpages.length,
      };
    } catch (error) {
      logger.error("Error cleaning up incomplete webpages", error, userId);
      return { updated: 0, error: error.message };
    }
  }

  async processBatch(urls, userId, userActivityId, websiteUrl, options = {}) {
    const concurrency = config.concurrency.fast_scraper;
    const limit = this.createConcurrencyLimiter(concurrency);
    const skipGrammarAndScores = options.skipGrammarAndScores === true;
    const processOne = skipGrammarAndScores ? this.processUrlFast.bind(this) : this.processUrl.bind(this);

    let successful = 0;
    let failed = 0;

    const promises = urls.map((url) =>
      limit(async () => {
        try {
          const result = await processOne(url, userId, userActivityId, websiteUrl);
          if (result.success) {
            successful++;
          } else {
            failed++;
          }
          return result;
        } catch (error) {
          failed++;
          logger.debug(`Failed to process ${url}: ${error.message}`, userId);
          return { success: false, url, error: error.message };
        }
      })
    );

    await Promise.all(promises);

    return { successful, failed };
  }

  /**
   * Scrape and save only – no grammar check, no fast scores.
   * Use when grammar/scores will be run in slow analyzer (e.g. Crawl V2).
   */
  async processUrlFast(url, userId, userActivityId, websiteUrl) {
    try {
      if (this.scraper.shouldStop) {
        throw new Error("Scraping stopped by user");
      }

      const scrapedData = await this.scrapeWebpageViaProxy(url, {
        timeout: config.timeouts.standard_request,
      });

      const webpageData = this.prepareWebpageDataMinimal(
        scrapedData,
        userId,
        userActivityId,
        websiteUrl
      );

      const savedWebpage = await this.webpageService.upsertWebpage(
        webpageData,
        userId,
        websiteUrl,
        url
      );

      if (savedWebpage) {
        return { success: true, url, webpageId: savedWebpage._id };
      } else {
        await this.saveFailedWebpage(
          url,
          userId,
          userActivityId,
          websiteUrl,
          "Failed to save to database"
        );
        return { success: false, url, error: "Failed to save to database" };
      }
    } catch (error) {
      await this.saveFailedWebpage(
        url,
        userId,
        userActivityId,
        websiteUrl,
        error.message
      );
      return { success: false, url, error: error.message };
    }
  }

  async processUrl(url, userId, userActivityId, websiteUrl) {
    try {
      if (this.scraper.shouldStop) {
        throw new Error("Scraping stopped by user");
      }

      const scrapedData = await this.scrapeWebpageViaProxy(url, {
        timeout: config.timeouts.standard_request,
      });

      const spellingIssues = await this.grammarChecker.checkContent(
        scrapedData.content,
        scrapedData.title,
        scrapedData.metaDescription
      );

      // Score is only written to core after slow analysis (see webpage-service). Here we only use it for
      // component scores (title, meta, etc.) and for the scores document; core seoScore stays 0 until then.
      const scores = this.scoreCalculator.calculateFastScores(
        scrapedData,
        spellingIssues
      );

      const webpageData = this.prepareWebpageData(
        scrapedData,
        scores,
        spellingIssues,
        userId,
        userActivityId,
        websiteUrl
      );

      const savedWebpage = await this.webpageService.upsertWebpage(
        webpageData,
        userId,
        websiteUrl,
        url
      );

      if (savedWebpage) {
        return { success: true, url, webpageId: savedWebpage._id };
      } else {
        await this.saveFailedWebpage(
          url,
          userId,
          userActivityId,
          websiteUrl,
          "Failed to save to database"
        );
        return { success: false, url, error: "Failed to save to database" };
      }
    } catch (error) {
      await this.saveFailedWebpage(
        url,
        userId,
        userActivityId,
        websiteUrl,
        error.message
      );
      return { success: false, url, error: error.message };
    }
  }

  async saveFailedWebpage(
    url,
    userId,
    userActivityId,
    websiteUrl,
    errorMessage
  ) {
    try {
      const failedWebpageData = {
        userId,
        userActivityId,
        websiteUrl,
        pageUrl: url,
        statusCode: 0,
        lastCrawled: new Date(),
        scrapedAt: new Date(),

        seoScore: 0,
        seoGrade: "F",

        title: "",
        titleLength: 0,
        titleScore: 0,
        titleTagCount: 0,

        metaDescription: "",
        metaDescriptionLength: 0,
        metaDescriptionScore: 0,

        content: "",
        wordCount: 0,
        contentScore: 0,

        headingStructure: {
          h1Count: 0,
          h2Count: 0,
          h3Count: 0,
          h4Count: 0,
          h5Count: 0,
          h6Count: 0,
          h1Text: "",
          h2Texts: [],
        },
        headingScore: 0,

        urlScore: 0,
        urlIssues: {
          tooLong: false,
          containsParams: false,
          containsSpecialChars: false,
          hasSpaces: false,
          hasUnderscores: false,
          nonDescriptive: false,
        },

        technicalSeo: {
          canonicalTagExists: false,
          canonicalUrl: "",
          robotsDirectives: "",
          hreflangTags: [],
          structuredData: false,
          hasViewport: false,
          hasCharset: false,
        },
        technicalScore: 0,

        images: {
          totalCount: 0,
          withAlt: 0,
          withTitle: 0,
          altMissingCount: 0,
          altTextPercentage: 0,
        },
        imageScore: 0,

        links: {
          totalCount: 0,
          internalCount: 0,
          externalCount: 0,
          internalBrokenLinksCount: 0,
          externalBrokenLinksCount: 0,
          redirectLinksCount: 0,
          httpLinksCount: 0,
          httpsLinksCount: 0,
        },
        linkScore: 0,

        performance: {
          pageSize: 0,
          mobileOptimized: {
            hasViewport: false,
            isResponsive: false,
          },
          webVitals: {
            estimatedLCP: 0,
            estimatedFID: 0,
            estimatedCLS: 0,
            lcpRating: "poor",
            fidRating: "poor",
            clsRating: "poor",
          },
          score: 0,
        },
        performanceScore: 0,

        grammarSpelling: {
          spellingErrors: [],
          grammarErrors: [],
          readabilityMetrics: {},
          readabilityScore: 0,
          contentQualityScore: 0,
          totalIssues: 0,
          hasSpellingErrors: false,
          hasGrammarErrors: false,
        },
        grammarScore: 0,

        titleIssues: {
          missing: true,
          tooShort: false,
          tooLong: false,
          multiple: false,
          duplicate: false,
        },
        metaDescriptionIssues: {
          missing: true,
          tooShort: false,
          tooLong: false,
          multiple: false,
          duplicate: false,
        },
        contentIssues: {
          tooShort: true,
          lowKeywordDensity: false,
          poorReadability: false,
        },

        processingMethod: "fast_nodejs_scraper",
        responseTime: 0,
        hasErrors: true,
        errorMessage: errorMessage,
        isProcessed: false,
        processedAt: new Date(),

        duplicates: {
          titleDuplicates: [],
          descriptionDuplicates: [],
          contentDuplicates: [],
        },
        duplicateScore: 0,
        internalBrokenLinks: [],
        externalBrokenLinks: [],
        redirectLinks: [],
        slowAnalysisCompleted: false,
      };

      const savedWebpage = await this.webpageService.upsertWebpage(
        failedWebpageData,
        userId,
        websiteUrl,
        url
      );

      logger.info(
        `Saved failed webpage: ${url} with error: ${errorMessage}`,
        userId
      );
      return savedWebpage;
    } catch (saveError) {
      logger.error(
        `Failed to save failed webpage ${url} to database: ${saveError.message}`,
        userId
      );
      return null;
    }
  }

  async scrapeWebpageViaProxy(url, options = {}) {
    const timeout = options.timeout || config.timeouts.standard_request;

    try {
      const response = await scraper.scrapeWebpage(url, {
        // timeout: 30000,
        timeout: 10000,
      });

      if (response.statusCode === 200) {
        return response;
      } else if (response.statusCode === 503) {
        throw new Error(
          `Proxy service temporarily unavailable: ${response.data.message}`
        );
      } else if (response.statusCode >= 400) {
        throw new Error(
          `Proxy service error (${response.statusCode}): ${
            response.data.message || response.data.error
          }`
        );
      } else {
        throw new Error(
          `Unexpected response from proxy service: ${JSON.stringify(response)}`
        );
      }
    } catch (error) {
      if (error.code === "ECONNABORTED") {
        throw new Error(`Proxy service timeout after ${timeout}ms`);
      } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        throw new Error(`Cannot connect to proxy service: ${error.message}`);
      } else if (error.response) {
        throw new Error(
          `Proxy service HTTP error (${error.response.status}): ${
            error.response.data?.message || error.message
          }`
        );
      } else {
        throw new Error(`Proxy service error: ${error.message}`);
      }
    }
  }

  prepareWebpageData(
    scrapedData,
    scores,
    spellingIssues,
    userId,
    userActivityId,
    websiteUrl
  ) {
    return {
      userId,
      userActivityId,
      websiteUrl: scrapedData.websiteUrl || websiteUrl,
      pageUrl: scrapedData.pageUrl || scrapedData.url,
      statusCode: scrapedData.statusCode || 200,
      lastCrawled: new Date(scrapedData.lastCrawled),
      scrapedAt: new Date(scrapedData.scrapedAt),

      seoScore: Math.round(scores.overall * 10) / 10,
      seoGrade: this.calculateGrade(scores.overall),

      title: scrapedData.title || "",
      titleLength: scrapedData.titleLength || 0,
      titleScore: Math.round(scores.title * 10) / 10,
      titleTagCount: scrapedData.titleTagCount || 1,

      metaDescription: scrapedData.metaDescription || "",
      metaDescriptionLength: scrapedData.metaDescriptionLength || 0,
      metaDescriptionScore: Math.round(scores.metaDescription * 10) / 10,

      content: scrapedData.content || "",
      wordCount: scrapedData.wordCount || 0,
      contentScore: Math.round(scores.content * 10) / 10,

      headingStructure: scrapedData.headingStructure,
      headingScore: Math.round(scores.headings * 10) / 10,

      urlScore: Math.round(scores.url * 10) / 10,
      urlIssues: this.analyzeUrlIssues(scrapedData.url),

      technicalSeo: scrapedData.technicalSeo,
      technicalScore: Math.round(scores.technical * 10) / 10,

      images: scrapedData.images,
      imageScore: Math.round(scores.images * 10) / 10,

      links: scrapedData.links,
      linkScore: Math.round(scores.links * 10) / 10,

      performance: this.estimatePerformance(scrapedData),
      performanceScore: Math.round(scores.performance * 10) / 10,

      grammarSpelling: {
        spellingErrors: spellingIssues.spellingErrors || [],
        grammarErrors: [],
        readabilityMetrics: spellingIssues.readabilityScore || {},
        readabilityScore:
          Math.round(spellingIssues.readabilityScore?.score * 10) / 10 || 0,
        contentQualityScore:
          Math.round(spellingIssues.contentQualityScore * 10) / 10 || 0,
        totalIssues: spellingIssues.spelling?.length || 0,
        hasSpellingErrors: (spellingIssues.spelling?.length || 0) > 0,
        hasGrammarErrors: false,
      },
      grammarScore: Math.round(scores.grammar * 10) / 10,

      titleIssues: this.analyzeTitleIssues(scrapedData.title),
      metaDescriptionIssues: this.analyzeMetaDescIssues(
        scrapedData.metaDescription
      ),
      contentIssues: this.analyzeContentIssues(
        scrapedData.content,
        scrapedData.wordCount
      ),

      processingMethod: "fast_nodejs_scraper",
      responseTime: scrapedData.response_time,
      hasErrors: false,
      isProcessed: true,
      processedAt: new Date(),

      duplicates: {
        titleDuplicates: [],
        descriptionDuplicates: [],
        contentDuplicates: [],
      },
      duplicateScore: 100,
      internalBrokenLinks: [],
      externalBrokenLinks: [],
      redirectLinks: [],
      slowAnalysisCompleted: false,
    };
  }

  /**
   * Minimal webpage payload: scrape data only, no grammar check, no fast scores.
   * Grammar and full score are done in slow analyzer (e.g. Crawl V2).
   */
  prepareWebpageDataMinimal(scrapedData, userId, userActivityId, websiteUrl) {
    return {
      userId,
      userActivityId,
      websiteUrl: scrapedData.websiteUrl || websiteUrl,
      pageUrl: scrapedData.pageUrl || scrapedData.url,
      statusCode: scrapedData.statusCode || 200,
      lastCrawled: new Date(scrapedData.lastCrawled),
      scrapedAt: new Date(scrapedData.scrapedAt),

      seoScore: 0,
      seoGrade: "F",

      title: scrapedData.title || "",
      titleLength: scrapedData.titleLength || 0,
      titleScore: 0,
      titleTagCount: scrapedData.titleTagCount || 1,

      metaDescription: scrapedData.metaDescription || "",
      metaDescriptionLength: scrapedData.metaDescriptionLength || 0,
      metaDescriptionScore: 0,

      content: scrapedData.content || "",
      wordCount: scrapedData.wordCount || 0,
      contentScore: 0,

      headingStructure: scrapedData.headingStructure,
      headingScore: 0,

      urlScore: 0,
      urlIssues: this.analyzeUrlIssues(scrapedData.url),

      technicalSeo: scrapedData.technicalSeo,
      technicalScore: 0,

      images: scrapedData.images,
      imageScore: 0,

      links: scrapedData.links,
      linkScore: 0,

      performance: this.estimatePerformance(scrapedData),
      performanceScore: 0,

      grammarSpelling: {
        spellingErrors: [],
        grammarErrors: [],
        readabilityMetrics: {},
        readabilityScore: 0,
        contentQualityScore: 0,
        totalIssues: 0,
        hasSpellingErrors: false,
        hasGrammarErrors: false,
      },
      grammarScore: 0,

      titleIssues: this.analyzeTitleIssues(scrapedData.title),
      metaDescriptionIssues: this.analyzeMetaDescIssues(
        scrapedData.metaDescription
      ),
      contentIssues: this.analyzeContentIssues(
        scrapedData.content,
        scrapedData.wordCount
      ),

      processingMethod: "fast_nodejs_scraper",
      responseTime: scrapedData.response_time,
      hasErrors: false,
      isProcessed: true,
      processedAt: new Date(),

      duplicates: {
        titleDuplicates: [],
        descriptionDuplicates: [],
        contentDuplicates: [],
      },
      duplicateScore: 100,
      internalBrokenLinks: [],
      externalBrokenLinks: [],
      redirectLinks: [],
      slowAnalysisCompleted: false,
    };
  }

  calculateGrade(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  analyzeUrlIssues(url) {
    return {
      tooLong: url.length > config.seo.url_max_length,
      containsParams: url.includes("?"),
      containsSpecialChars:
        /[^a-zA-Z0-9\-\._~:\/\?#\[\]@!\$&'\(\)\*\+,;=]/.test(url),
      hasSpaces: url.includes(" "),
      hasUnderscores: url.includes("_"),
      nonDescriptive: /\/\d+\/?$/.test(url),
    };
  }

  analyzeTitleIssues(title) {
    return {
      missing: !title || title.length === 0,
      tooShort: title.length < config.seo.title_min_length,
      tooLong: title.length > config.seo.title_max_length,
      multiple: false,
      duplicate: false,
    };
  }

  analyzeMetaDescIssues(metaDesc) {
    return {
      missing: !metaDesc || metaDesc.length === 0,
      tooShort: metaDesc.length < config.seo.meta_desc_min_length,
      tooLong: metaDesc.length > config.seo.meta_desc_max_length,
      multiple: false,
      duplicate: false,
    };
  }

  analyzeContentIssues(content, wordCount) {
    return {
      tooShort: wordCount < config.seo.content_min_words,
      lowKeywordDensity: false,
      poorReadability: false,
    };
  }

  estimatePerformance(scrapedData) {
    const contentSize = (scrapedData.content || "").length;

    const estimatedLCP = Math.max(
      1.0,
      contentSize / 1000 + scrapedData.response_time / 1000
    );
    const estimatedFID = Math.min(300, scrapedData.response_time / 10);
    const estimatedCLS = 0.1;

    return {
      pageSize: Math.round(contentSize / 1024),
      mobileOptimized: {
        hasViewport: scrapedData.technicalSeo?.hasViewport || false,
        isResponsive: true,
      },
      webVitals: {
        estimatedLCP,
        estimatedFID,
        estimatedCLS,
        lcpRating:
          estimatedLCP <= 2.5
            ? "good"
            : estimatedLCP <= 4.0
            ? "needs-improvement"
            : "poor",
        fidRating:
          estimatedFID <= 100
            ? "good"
            : estimatedFID <= 300
            ? "needs-improvement"
            : "poor",
        clsRating:
          estimatedCLS <= 0.1
            ? "good"
            : estimatedCLS <= 0.25
            ? "needs-improvement"
            : "poor",
      },
      score: 0,
    };
  }

  calculateEstimatedTime(totalUrls) {
    const processed = this.stats.processed;
    const elapsed = Date.now() - this.stats.startTime;

    if (processed === 0) return 0;

    const avgTimePerUrl = elapsed / processed;
    const remaining = totalUrls - processed;

    return Math.round((remaining * avgTimePerUrl) / 1000);
  }

  createConcurrencyLimiter(concurrency) {
    let running = 0;
    const queue = [];

    return function (fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        run();
      });
    };

    function run() {
      if (running >= concurrency || queue.length === 0) return;

      running++;
      const { fn, resolve, reject } = queue.shift();

      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          running--;
          run();
        });
    }
  }

  resetStats() {
    this.stats.processed = 0;
    this.stats.successful = 0;
    this.stats.failed = 0;
    this.stats.batches_completed = 0;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      ...this.stats,
      success_rate:
        this.stats.processed > 0
          ? ((this.stats.successful / this.stats.processed) * 100).toFixed(2) +
            "%"
          : "0%",
      scraper_stats: this.scraper.getStats(),
      grammar_checker_stats: this.grammarChecker.getStats(),
    };
  }

  cleanup() {
    this.scraper.cleanup();
  }
}

module.exports = FastScraperJob;
