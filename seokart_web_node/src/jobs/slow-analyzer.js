const DuplicateProcessor = require("../processors/duplicate-processor");
const LinkProcessor = require("../processors/link-processor");
const ScoreCalculator = require("../processors/score-calculator");
const WebpageService = require("../services/webpage-service");
const ActivityService = require("../services/activity-service");
const config = require("../config/scraper");
const logger = require("../config/logger");

const {
  WebpageCore,
  WebpageContent,
  WebpageScores,
  WebpageTechnical,
  WebpageAnalysis,
} = require("../models/webpage-models");

class SlowAnalyzerJob {
  constructor() {
    this.duplicateProcessor = new DuplicateProcessor();
    this.linkProcessor = new LinkProcessor();
    this.scoreCalculator = new ScoreCalculator();
    this.webpageService = new WebpageService();
    this.activityService = new ActivityService();

    this.stats = {
      analyzed: 0,
      updated: 0,
      failed: 0,
      startTime: null,
      duplicatesFound: 0,
      internalBrokenLinksFound: 0,
      externalBrokenLinksFound: 0,
      redirectLinksFound: 0,
    };
  }

  async analyzeWebpages(userId, userActivityId, websiteUrl) {
    this.stats.startTime = Date.now();
    this.resetStats();

    logger.info(`Starting slow analysis for website: ${websiteUrl}`, userId);

    try {
      await this.activityService.updateProgress(userActivityId, {
        progress: 85,
        isWebpageCrawling: 2,
        status: "analyzing",
      });

      logger.info("Starting detailed content analysis...", userId);

      const webpages = await this.getWebpagesForAnalysis(userActivityId);
      const failedPagesCount = await this.getFailedPagesCount(userActivityId);

      if (!webpages || webpages.length === 0) {
        logger.warn("No webpages found for slow analysis", userId);

        if (failedPagesCount > 0) {
          logger.warn(
            `Found ${failedPagesCount} failed pages with no successful ones`,
            userId
          );
        }

        return {
          analyzed: 0,
          updated: 0,
          failedPages: failedPagesCount,
        };
      }

      logger.info(
        `Found ${webpages.length} webpages for slow analysis (${failedPagesCount} failed pages skipped)`,
        userId
      );

      await this.detectDuplicates(webpages, userId, userActivityId, websiteUrl);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        90,
        "Duplicate analysis completed"
      );

      await this.validateLinks(webpages, userId, userActivityId);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        95,
        "Link validation completed"
      );

      await this.recalculateScores(webpages, userId, userActivityId);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        100,
        "Score recalculation completed"
      );

      await this.activityService.updateProgress(userActivityId, {
        progress: 100,
        isWebpageCrawling: 0,
        status: "completed",
        endTime: new Date(),
        slowAnalysisCompleted: true,
      });

      const totalTime = Date.now() - this.stats.startTime;
      logger.info("Detailed analysis completed successfully", userId);

      logger.info(
        `Slow analysis completed: ${this.stats.updated}/${webpages.length} updated (${totalTime}ms total, ${failedPagesCount} failed pages)`,
        userId
      );

      return {
        analyzed: this.stats.analyzed,
        updated: this.stats.updated,
        duplicatesFound: this.stats.duplicatesFound,
        internalBrokenLinksFound: this.stats.internalBrokenLinksFound,
        externalBrokenLinksFound: this.stats.externalBrokenLinksFound,
        redirectLinksFound: this.stats.redirectLinksFound,
        failedPages: failedPagesCount,
        totalTime,
      };
    } catch (error) {
      logger.error("Error during slow analysis", error, userId);

      await this.activityService.updateProgress(userActivityId, {
        status: "failed",
        endTime: new Date(),
        errorMessages: [error.message],
      });

      logger.error("Slow analysis failed", error, userId);

      throw error;
    }
  }

  async getWebpagesForAnalysis(userActivityId) {
    try {
      return await WebpageCore.find({
        userActivityId,
        slowAnalysisCompleted: { $ne: true },
        hasErrors: { $ne: true },
        isProcessed: true,
      }).lean();
    } catch (error) {
      logger.error("Error getting webpages for analysis", error);
      return [];
    }
  }

  async getFailedPagesCount(userActivityId) {
    try {
      return await WebpageCore.countDocuments({
        userActivityId,
        hasErrors: true,
      });
    } catch (error) {
      logger.error("Error getting failed pages count", error);
      return 0;
    }
  }

  async detectDuplicates(webpages, userId, userActivityId, websiteUrl) {
    logger.info("Phase 1: Detecting duplicates", userId);

    const batchSize = config.batch_sizes.duplicate_check || 30;
    const totalBatches = Math.ceil(webpages.length / batchSize);
    const batchDelay = config.batch_delays?.duplicate_check ?? 100;

    // Load all webpages once so we don't query DB on every batch (huge win for 2500+ pages)
    const allWebpages = await this.duplicateProcessor.loadAllWebpagesForSite(userId, websiteUrl);
    logger.info(`Loaded ${allWebpages.length} site webpages once for duplicate check`, userId);

    for (let i = 0; i < webpages.length; i += batchSize) {
      const batch = webpages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      logger.debug(
        `Processing duplicate batch ${batchNumber}/${totalBatches}`,
        userId
      );

      const duplicateResults = await this.duplicateProcessor.findDuplicates(
        batch,
        userId,
        websiteUrl,
        allWebpages
      );

      // Parallelize duplicate updates for this batch
      const updatePromises = batch.map(async (webpage) => {
        const duplicates = duplicateResults.get(webpage._id.toString());
        if (duplicates) {
          this.stats.duplicatesFound +=
            duplicates.titleDuplicates.length +
            duplicates.descriptionDuplicates.length +
            duplicates.contentDuplicates.length;
          const duplicateScore = this.calculateDuplicateScore(duplicates);
          await this.updateWebpageWithDuplicates(webpage._id, duplicates, duplicateScore);
        } else {
          await this.updateWebpageWithDuplicates(webpage._id, {
            titleDuplicates: [],
            descriptionDuplicates: [],
            contentDuplicates: [],
          }, 100);
        }
        this.stats.analyzed++;
      });
      await Promise.all(updatePromises);

      try {
        if (
          this.notificationService &&
          typeof this.notificationService.emitBatchProgress === "function"
        ) {
          this.notificationService.emitBatchProgress(userId, {
            activityId: userActivityId,
            phase: "duplicate_detection",
            batchNumber,
            totalBatches,
            processed: Math.min(i + batchSize, webpages.length),
            total: webpages.length,
          });
        }
      } catch (notificationError) {
        logger.error(
          "Error emitting batch progress notification",
          notificationError,
          userId
        );
      }

      if (i + batchSize < webpages.length) {
        await this.sleep(batchDelay);
      }
    }
  }

  async validateLinks(webpages, userId, userActivityId) {
    logger.info("Phase 2: Validating links", userId);

    const batchSize = config.batch_sizes.link_validation || 30;
    const totalBatches = Math.ceil(webpages.length / batchSize);
    const batchDelay = config.batch_delays?.link_validation ?? 200;
    let processedPages = 0;

    for (let i = 0; i < webpages.length; i += batchSize) {
      const batch = webpages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      logger.debug(
        `Processing link validation batch ${batchNumber}/${totalBatches}`,
        userId
      );

      const concurrency = config.concurrency.link_validation || config.concurrency.slow_analyzer || 5;
      const limit = this.createConcurrencyLimiter(concurrency);

      const promises = batch.map((webpage) =>
        limit(async () => {
          try {
            logger.info(`Validating links for: ${webpage.pageUrl}`, userId);

            // CRITICAL FIX: Load complete webpage data with technical information
            const completeWebpage = await this.getCompleteWebpageData(
              webpage._id
            );

            if (!completeWebpage) {
              logger.warn(
                `Could not load complete data for link validation: ${webpage.pageUrl}`,
                userId
              );

              // Still update with empty arrays to mark as processed
              await this.updateWebpageWithLinks(webpage._id, {
                internalBrokenLinks: [],
                externalBrokenLinks: [],
                redirectLinks: [],
              });

              return {
                success: false,
                webpageId: webpage._id,
                error: "Could not load complete webpage data",
              };
            }

            logger.debug(
              `Complete webpage data loaded for ${webpage.pageUrl}. ` +
                `Has technical: ${!!completeWebpage.technical}, ` +
                `Has links: ${!!completeWebpage.links}`
            );

            const linkResults = await this.linkProcessor.validatePageLinks(
              completeWebpage
            );

            const hasIssues =
              linkResults.internalBrokenLinks.length > 0 ||
              linkResults.externalBrokenLinks.length > 0 ||
              linkResults.redirectLinks.length > 0;

            if (hasIssues) {
              logger.warn(
                `Found ${linkResults.internalBrokenLinks.length} internal broken, ` +
                  `${linkResults.externalBrokenLinks.length} external broken, ` +
                  `${linkResults.redirectLinks.length} redirect links on ${webpage.pageUrl}`,
                userId
              );

              await this.updateWebpageWithLinks(webpage._id, linkResults);

              this.stats.internalBrokenLinksFound +=
                linkResults.internalBrokenLinks.length;
              this.stats.externalBrokenLinksFound +=
                linkResults.externalBrokenLinks.length;
              this.stats.redirectLinksFound += linkResults.redirectLinks.length;
            } else {
              logger.debug(`No link issues found on ${webpage.pageUrl}`);

              await this.updateWebpageWithLinks(webpage._id, {
                internalBrokenLinks: [],
                externalBrokenLinks: [],
                redirectLinks: [],
              });
            }

            this.stats.updated++;
            return {
              success: true,
              webpageId: webpage._id,
              internalBrokenLinks: linkResults.internalBrokenLinks.length,
              externalBrokenLinks: linkResults.externalBrokenLinks.length,
              redirectLinks: linkResults.redirectLinks.length,
            };
          } catch (error) {
            this.stats.failed++;
            logger.error(
              `Failed to validate links for ${webpage.pageUrl}: ${error.message}`,
              userId
            );
            logger.error(error.stack);
            return {
              success: false,
              webpageId: webpage._id,
              error: error.message,
            };
          }
        })
      );

      await Promise.all(promises);
      processedPages += batch.length;

      try {
        if (
          this.notificationService &&
          typeof this.notificationService.emitBatchProgress === "function"
        ) {
          this.notificationService.emitBatchProgress(userId, {
            activityId: userActivityId,
            phase: "link_validation",
            batchNumber,
            totalBatches,
            processed: processedPages,
            total: webpages.length,
            internalBrokenLinksFound: this.stats.internalBrokenLinksFound,
            externalBrokenLinksFound: this.stats.externalBrokenLinksFound,
            redirectLinksFound: this.stats.redirectLinksFound,
          });
        }
      } catch (notificationError) {
        logger.error(
          "Error emitting batch progress notification",
          notificationError,
          userId
        );
      }

      if (i + batchSize < webpages.length) {
        await this.sleep(batchDelay);
      }
    }
  }

  async getCompleteWebpageData(webpageId) {
    try {
      const webpageCore = await WebpageCore.findById(webpageId).lean();

      if (!webpageCore) {
        logger.warn(`WebpageCore not found for ID: ${webpageId}`);
        return null;
      }

      const [content, technical, analysis] = await Promise.all([
        webpageCore.contentId
          ? WebpageContent.findById(webpageCore.contentId).lean()
          : Promise.resolve(null),
        webpageCore.technicalId
          ? WebpageTechnical.findById(webpageCore.technicalId).lean()
          : Promise.resolve(null),
        webpageCore.analysisId
          ? WebpageAnalysis.findById(webpageCore.analysisId).lean()
          : Promise.resolve(null),
      ]);

      return {
        ...webpageCore,
        title: content?.title || webpageCore.title,
        titleLength: content?.titleLength || webpageCore.titleLength,
        metaDescription:
          content?.metaDescription || webpageCore.metaDescription,
        metaDescriptionLength:
          content?.metaDescriptionLength || webpageCore.metaDescriptionLength,
        wordCount: content?.wordCount || webpageCore.wordCount,
        headingStructure: content?.headingStructure,
        titleTagCount: content?.titleTagCount,
        content: content,
        technicalSeo: technical?.technicalSeo,
        links: technical?.links,
        internalBrokenLinks: technical?.internalBrokenLinks || [],
        externalBrokenLinks: technical?.externalBrokenLinks || [],
        redirectLinks: technical?.redirectLinks || [],
        performance: technical?.performance,
        technical: technical,
        images: analysis?.images,
        duplicates: analysis?.duplicates,
        grammarSpelling: analysis?.contentQuality,
        analysis: analysis,
      };
    } catch (error) {
      logger.error(
        `Error fetching complete webpage data for ${webpageId}:`,
        error
      );
      return null;
    }
  }

  // Recalculates SEO score using same 20-point formula as fast scraper, but with full data
  // (duplicates + broken/redirect links). This overwrites the preliminary score from fast scraper.
  async recalculateScores(webpages, userId, userActivityId) {
    logger.info("Phase 3: Recalculating scores", userId);

    const batchSize = config.batch_sizes.score_recalc || 30;
    const totalBatches = Math.ceil(webpages.length / batchSize);
    const concurrency = Math.min(config.concurrency.slow_analyzer || 8, batchSize);
    const limit = this.createConcurrencyLimiter(concurrency);
    let processedPages = 0;

    const processOne = async (webpage) => {
      try {
        const completeWebpage = await this.getCompleteWebpageData(webpage._id);
        if (!completeWebpage) {
          logger.warn(`Could not load complete data for ${webpage.pageUrl}`, userId);
          return 0;
        }

        if (completeWebpage.technicalId) {
          const freshTechnical = await WebpageTechnical.findById(completeWebpage.technicalId).lean();
          if (freshTechnical) {
            completeWebpage.technical = freshTechnical;
            completeWebpage.links = freshTechnical.links;
            completeWebpage.redirectLinks = freshTechnical.redirectLinks || [];
            completeWebpage.internalBrokenLinks = freshTechnical.internalBrokenLinks || [];
            completeWebpage.externalBrokenLinks = freshTechnical.externalBrokenLinks || [];
            completeWebpage.httpLinks = freshTechnical.httpLinks || [];
          }
        }

        const scoreResult = this.scoreCalculator.calculateNewSystemScores(completeWebpage);
        const newScores = scoreResult.scores;
        const totalScore = scoreResult.totalScore;
        const grade = scoreResult.grade;

        await WebpageCore.findByIdAndUpdate(webpage._id, {
          seoScore: Math.round(totalScore * 10) / 10,
          seoGrade: grade,
          slowAnalysisCompleted: true,
          updatedAt: new Date(),
        });

        if (completeWebpage.scoresId) {
          await WebpageScores.findByIdAndUpdate(completeWebpage.scoresId, {
            seoScore: Math.round(totalScore * 10) / 10,
            seoGrade: grade,
            scores: {
              titleNotMissing: newScores.titleNotMissing,
              titleRightLength: newScores.titleRightLength,
              titleNotDuplicated: newScores.titleNotDuplicated,
              metaDescNotMissing: newScores.metaDescNotMissing,
              metaDescRightLength: newScores.metaDescRightLength,
              metaDescNotDuplicated: newScores.metaDescNotDuplicated,
              contentNotTooShort: newScores.contentNotTooShort,
              noMultipleTitles: newScores.noMultipleTitles,
              oneH1Only: newScores.oneH1Only,
              headingsProperOrder: newScores.headingsProperOrder,
              urlNotTooLong: newScores.urlNotTooLong,
              canonicalTagExists: newScores.canonicalTagExists,
              noRedirectLinks: newScores.noRedirectLinks,
              noHttpLinks: newScores.noHttpLinks,
              noInternalBrokenLinks: newScores.noInternalBrokenLinks,
              noExternalBrokenLinks: newScores.noExternalBrokenLinks,
              mobileResponsive: newScores.mobileResponsive,
              imagesHaveAltText: newScores.imagesHaveAltText,
              noGrammarSpellingErrors: newScores.noGrammarSpellingErrors,
              contentNotDuplicated: newScores.contentNotDuplicated,
            },
            lastCalculated: new Date(),
          });
        }

        if (completeWebpage.analysisId) {
          await WebpageAnalysis.findByIdAndUpdate(completeWebpage.analysisId, { slowAnalysisCompleted: true });
        }

        logger.debug(`Scores updated for ${webpage.pageUrl}`, userId);
        return 1;
      } catch (error) {
        logger.error(`Failed to recalculate scores for ${webpage.pageUrl}: ${error.message}`, userId);
        return 0;
      }
    };

    for (let i = 0; i < webpages.length; i += batchSize) {
      const batch = webpages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      const results = await Promise.all(batch.map((webpage) => limit(() => processOne(webpage))));
      processedPages += results.reduce((a, b) => a + b, 0);

      logger.debug(`Score recalc batch ${batchNumber}/${totalBatches}`, userId);
    }

    logger.info(`Recalculated scores for ${processedPages}/${webpages.length} pages`, userId);
  }

  async updateWebpageWithDuplicates(webpageId, duplicates, duplicateScore) {
    try {
      const webpageCore = await WebpageCore.findById(webpageId).lean();

      if (!webpageCore) {
        logger.error(`WebpageCore not found for ${webpageId}`);
        return;
      }

      if (webpageCore.analysisId) {
        await WebpageAnalysis.findByIdAndUpdate(webpageCore.analysisId, {
          "duplicates.titleDuplicates": duplicates.titleDuplicates || [],
          "duplicates.descriptionDuplicates":
            duplicates.descriptionDuplicates || [],
          "duplicates.contentDuplicates": duplicates.contentDuplicates || [],
          updatedAt: new Date(),
        });
      }

      logger.debug(`Updated duplicates for ${webpageId}`);
    } catch (error) {
      logger.error(
        `Error updating webpage ${webpageId} with duplicates`,
        error
      );
    }
  }

  async updateWebpageWithLinks(webpageId, linkResults) {
    logger.debug(
      `Updating links for ${webpageId}: ` +
        `${linkResults.internalBrokenLinks.length} internal broken, ` +
        `${linkResults.externalBrokenLinks.length} external broken, ` +
        `${linkResults.redirectLinks.length} redirects`
    );

    try {
      const webpageCore = await WebpageCore.findById(webpageId).lean();

      if (!webpageCore) {
        logger.error(`WebpageCore not found for ${webpageId}`);
        return;
      }

      if (!webpageCore.technicalId) {
        logger.error(`technicalId not found for WebpageCore ${webpageId}`);
        return;
      }

      await WebpageTechnical.findOneAndUpdate(
        { webpageCoreId: webpageCore._id },
        {
          internalBrokenLinks: linkResults.internalBrokenLinks,
          externalBrokenLinks: linkResults.externalBrokenLinks,
          redirectLinks: linkResults.redirectLinks,
          "links.internalBrokenLinksCount":
            linkResults.internalBrokenLinks.length,
          "links.externalBrokenLinksCount":
            linkResults.externalBrokenLinks.length,
          "links.redirectLinksCount": linkResults.redirectLinks.length,
          updatedAt: new Date(),
        },
        { new: true }
      );

      logger.info(
        `✅ Updated links for ${webpageId}: ` +
          `${linkResults.internalBrokenLinks.length} internal broken, ` +
          `${linkResults.externalBrokenLinks.length} external broken, ` +
          `${linkResults.redirectLinks.length} redirects`
      );
    } catch (error) {
      logger.error(`Error updating webpage ${webpageId} with links:`, error);
    }
  }

  calculateDuplicateScore(duplicates) {
    let score = 100;

    const titleDupes = duplicates.titleDuplicates?.length || 0;
    const descDupes = duplicates.descriptionDuplicates?.length || 0;
    const contentDupes = duplicates.contentDuplicates?.length || 0;

    score -= titleDupes * 20;
    score -= descDupes * 15;
    score -= contentDupes * 25;

    return Math.max(0, score);
  }

  calculateGrade(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  async updateProgressAndNotify(userId, userActivityId, progress, message) {
    await this.activityService.updateProgress(userActivityId, { progress });
    logger.debug(`Progress: ${progress}% - ${message}`, userId);
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
    this.stats.analyzed = 0;
    this.stats.updated = 0;
    this.stats.failed = 0;
    this.stats.duplicatesFound = 0;
    this.stats.internalBrokenLinksFound = 0;
    this.stats.externalBrokenLinksFound = 0;
    this.stats.redirectLinksFound = 0;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      ...this.stats,
      success_rate:
        this.stats.analyzed > 0
          ? ((this.stats.updated / this.stats.analyzed) * 100).toFixed(2) + "%"
          : "0%",
      duplicateProcessor_stats: this.duplicateProcessor.getStats(),
      linkProcessor_stats: this.linkProcessor.getStats(),
    };
  }
}

module.exports = SlowAnalyzerJob;
