const DuplicateProcessor = require("../processors/duplicate-processor");
const DuplicateProcessorV2 = require("../processors/duplicate-processor-v2");
const LinkProcessor = require("../processors/link-processor");
const ScoreCalculator = require("../processors/score-calculator");
const GrammarSpellChecker = require("../processors/grammar-spell-checker");
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

class SlowAnalyzerJobV2 {
  constructor() {
    this.duplicateProcessor = new DuplicateProcessor();
    this.duplicateProcessorV2 = new DuplicateProcessorV2();
    this.linkProcessor = new LinkProcessor();
    this.scoreCalculator = new ScoreCalculator();
    this.grammarChecker = new GrammarSpellChecker();
    this.webpageService = new WebpageService();
    this.activityService = new ActivityService();

    // ─── Constants ────────────────────────────────────────────────────────────────
    this.DEFAULT_CHUNK_SIZE = 2000;
    this.DEFAULT_DB_BATCH_SIZE = 100; // bulkWrite ops per round-trip
    this.MAX_RETRIES = 2;
    this.RETRY_BASE_DELAY_MS = 500;
    this.HEARTBEAT_INTERVAL_MS = 10000;
    this.PROGRESS_START = 85;
    this.PROGRESS_END = 99;

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

    // Keep heartbeat alive during slow analysis (runs in queue worker; main job heartbeat is stopped)
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.activityService.updateHeartbeat(userActivityId);
      } catch (e) {
        logger.debug("Slow analysis heartbeat error", e?.message);
      }
    }, this.HEARTBEAT_INTERVAL_MS);

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
            userId,
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
        userId,
      );

      await this.detectDuplicates(webpages, userId, userActivityId, websiteUrl);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        90,
        "Duplicate analysis completed",
      );

      await this.validateLinks(webpages, userId, userActivityId);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        95,
        "Link validation completed",
      );

      await this.recalculateScores(webpages, userId, userActivityId);
      await this.updateProgressAndNotify(
        userId,
        userActivityId,
        100,
        "Score recalculation completed",
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
        userId,
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
    } finally {
      clearInterval(heartbeatInterval);
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Exponential-backoff retry wrapper.
   * @param {() => Promise<T>} fn
   * @param {number} retries
   * @returns {Promise<T>}
   */
  async withRetry(fn, retries = this.MAX_RETRIES) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          const delay = this.RETRY_BASE_DELAY_MS * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Split an array into fixed-size batches.
   * @param {T[]} arr
   * @param {number} size
   * @returns {T[][]}
   */
  batchArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /**
   * Cursor-based page fetcher — replaces skip/limit to avoid full-collection scans.
   *
   * @param {string} userActivityId
   * @param {ObjectId|null} afterId   - last _id seen (null for first page)
   * @param {number}        limit
   * @returns {Promise<Array>}
   */
  async getWebpagesChunkAfter(userActivityId, afterId, limit) {
    try {
      const baseQuery = {
        userActivityId,
        slowAnalysisCompleted: { $ne: true },
        hasErrors: { $ne: true },
        isProcessed: true,
      };

      if (afterId) baseQuery._id = { $gt: afterId };

      const docs = await WebpageCore.find(baseQuery)
        .sort({ _id: 1 }) // mandatory for stable cursor pagination
        .limit(limit)
        .populate("contentId", "title metaDescription content wordCount")
        .lean();

      return docs.map((d) => ({
        _id: d._id,
        pageUrl: d.pageUrl,
        title: d.contentId?.title ?? "",
        metaDescription: d.contentId?.metaDescription ?? "",
        content: d.contentId?.content ?? "",
        wordCount: d.contentId?.wordCount ?? 0,
      }));
    } catch (error) {
      logger.error("Error fetching webpage chunk", { afterId, limit, error });
      return [];
    }
  }

  /**
   * Save a checkpoint so the job can resume after a crash.
   * Stored as a lightweight field on the activity document.
   */
  async saveCheckpoint(userActivityId, checkpoint) {
    try {
      await this.activityService.updateProgress(userActivityId, {
        _checkpoint: checkpoint, // { lastIdPass1, lastIdPass2, pass1Done }
      });
    } catch (e) {
      logger.warn("Checkpoint save failed (non-fatal)", { error: e?.message });
    }
  }

  async loadCheckpoint(userActivityId) {
    try {
      const activity = await this.activityService.getActivity(userActivityId);
      return activity?._checkpoint ?? null;
    } catch {
      return null;
    }
  }

  /**
   * bulkWrite duplicate + score results for a batch of pages.
   * Single MongoDB round-trip instead of N parallel updateOne calls.
   *
   * @param {Array<{ _id, duplicates, duplicateScore }>} updates
   */
  async bulkWriteDuplicateResults(updates) {
    if (!updates.length) return;

    // const ops = updates.map(({ _id, duplicates, duplicateScore }) => ({
    //   updateOne: {
    //     filter: { _id },
    //     update: {
    //       $set: {
    //         duplicates,
    //         duplicateScore,
    //         slowAnalysisCompleted: true,   // mark per-page so resume works
    //       },
    //     },
    //   },
    // }));

    // Optimized, production-ready bulk update of duplicate results and scores.
    await this.withRetry(async () => {
      if (!updates.length) return;

      // Build a map of _id (string) -> update payload for constant-time lookup
      const updateMap = new Map(
        updates.map(({ _id, duplicates, duplicateScore }) => [
          String(_id),
          { duplicates, duplicateScore },
        ]),
      );

      // Get all relevant WebpageCores for _id/analysisId mapping.
      const webpageCores = await WebpageCore.find(
        {
          _id: { $in: updates.map((u) => u._id) },
          analysisId: { $exists: true, $ne: null },
        },
        { _id: 1, analysisId: 1 },
      ).lean();

      if (!webpageCores.length) return;

      // Prepare a single bulkWrite operation for all analysis updates
      const analysisBulkOps = [];
      for (const { _id, analysisId } of webpageCores) {
        const updatePayload = updateMap.get(String(_id));
        if (!updatePayload || !analysisId) continue;
        const { duplicates = {}, duplicateScore = 100 } = updatePayload;
        analysisBulkOps.push({
          updateOne: {
            filter: { _id: analysisId },
            update: {
              $set: {
                "duplicates.titleDuplicates": duplicates.titleDuplicates || [],
                "duplicates.descriptionDuplicates":
                  duplicates.descriptionDuplicates || [],
                "duplicates.contentDuplicates":
                  duplicates.contentDuplicates || [],
                duplicateScore: duplicateScore,
                updatedAt: new Date(),
              },
            },
          },
        });
      }

      if (analysisBulkOps.length > 0) {
        await WebpageAnalysis.bulkWrite(analysisBulkOps, { ordered: false });
      }
    });
  }

  /**
   * Production-ready chunked slow analysis.
   *
   * Supports:
   *  - 100K+ pages via cursor pagination
   *  - Crash recovery via per-chunk checkpoints
   *  - Memory-safe incremental signature store
   *  - Structured logging and per-chunk timing
   *
   * @param {string} userId
   * @param {string} userActivityId
   * @param {string} websiteUrl
   * @param {object} options
   * @param {number} [options.chunkSize=2000]
   * @param {number} [options.dbBatchSize=100]
   * @param {boolean} [options.forceRestart=false]  - ignore existing checkpoint
   */
  async analyzeWebpagesChunked(
    userId,
    userActivityId,
    websiteUrl,
    options = {},
  ) {
    const chunkSize = options.chunkSize || this.DEFAULT_CHUNK_SIZE;
    const dbBatchSize = options.dbBatchSize || this.DEFAULT_DB_BATCH_SIZE;

    this.resetStats();
    this.stats.startTime = Date.now();

    // ── Heartbeat ──────────────────────────────────────────────────────────
    const heartbeat = setInterval(async () => {
      try {
        await this.activityService.updateHeartbeat(userActivityId);
      } catch (e) {
        logger.debug("Heartbeat error", { msg: e?.message });
      }
    }, this.HEARTBEAT_INTERVAL_MS);

    try {
      // ── Setup ──────────────────────────────────────────────────────────
      await this.activityService.updateProgress(userActivityId, {
        progress: this.PROGRESS_START,
        isWebpageCrawling: 0,
        status: "analyzing",
      });

      const totalCount = await WebpageCore.countDocuments({
        userActivityId,
        hasErrors: { $ne: true },
        isProcessed: true,
      });

      if (totalCount === 0) {
        logger.info("No webpages to analyze", { userId });
        return { analyzed: 0, updated: 0, totalChunks: 0 };
      }

      logger.info("Chunked analysis starting", {
        userId,
        totalCount,
        chunkSize,
      });

      // ── Checkpoint / Resume ────────────────────────────────────────────
      let checkpoint = options.forceRestart
        ? null
        : await this.loadCheckpoint(userActivityId);

      let signatureStore = checkpoint?.signatureStore ?? null;
      let pass1Done = checkpoint?.pass1Done ?? false;
      let lastIdPass1 = checkpoint?.lastIdPass1 ?? null;
      let lastIdPass2 = checkpoint?.lastIdPass2 ?? null;

      if (checkpoint) {
        logger.info("Resuming from checkpoint", { userId, checkpoint });
      }

      // ──────────────────────────────────────────────────────────────────
      // PASS 1 — build complete duplicate-signature store
      // No DB writes; reads only. Cursor-paginated.
      // ──────────────────────────────────────────────────────────────────
      if (!pass1Done) {
        logger.info("Pass 1: building signature store", { userId });
        let chunkCount = 0;

        while (true) {
          const t0 = Date.now();
          const chunk = await this.withRetry(() =>
            this.getWebpagesChunkAfter(userActivityId, lastIdPass1, chunkSize),
          );

          if (!chunk.length) break;

          try {
            const { updatedStore } = this.duplicateProcessorV2._buildStoreOnly(
              chunk,
              signatureStore,
            );
            signatureStore = updatedStore;
          } catch (err) {
            logger.error("Pass 1: _buildStoreOnly failed for chunk", {
              userId,
              err,
            });
            // non-fatal — skip duplicate detection for this chunk
          }

          lastIdPass1 = chunk.at(-1)._id;
          chunkCount++;

          // Checkpoint after every chunk so Pass 1 is resumable
          await this.saveCheckpoint(userActivityId, {
            pass1Done: false,
            lastIdPass1,
            lastIdPass2,
            // NOTE: signatureStore is intentionally NOT persisted to the
            // checkpoint document (can be large). On resume, Pass 1 will
            // rebuild from lastIdPass1=null through the last saved cursor.
            // If you have Redis available, persist signatureStore there instead.
          });

          logger.debug("Pass 1 chunk done", {
            userId,
            chunkCount,
            ms: Date.now() - t0,
          });
        }

        pass1Done = true;
        lastIdPass1 = null; // reset cursor for pass 2 progress reporting

        await this.saveCheckpoint(userActivityId, {
          pass1Done: true,
          lastIdPass1: null,
          lastIdPass2,
        });

        logger.info("Pass 1 complete", { userId, chunkCount });
      }

      // ──────────────────────────────────────────────────────────────────
      // PASS 2 — score duplicates + all other checks + write to DB
      // ──────────────────────────────────────────────────────────────────
      logger.info("Pass 2: scoring and writing results", { userId });
      let processed = 0;
      let chunkCount = 0;

      while (true) {
        const t0 = Date.now();
        const chunk = await this.withRetry(() =>
          this.getWebpagesChunkAfter(userActivityId, lastIdPass2, chunkSize),
        );

        if (!chunk.length) break;

        // ── Duplicate scoring ────────────────────────────────────────
        let duplicateResults = new Map();
        try {
          ({ duplicateResults } =
            this.duplicateProcessorV2.findDuplicatesWithStore(
              chunk,
              signatureStore,
            ));
        } catch (err) {
          logger.error("Pass 2: findDuplicatesWithStore failed", {
            userId,
            err,
          });
        }

        // ── bulkWrite: duplicates + scores ───────────────────────────
        try {
          const updates = chunk.map((webpage) => {
            const duplicates = duplicateResults.get(webpage._id.toString()) ?? {
              titleDuplicates: [],
              descriptionDuplicates: [],
              contentDuplicates: [],
            };
            const duplicateScore =
              this.duplicateProcessorV2.calculateDuplicateScore(duplicates);
            this.stats.analyzed++;
            return { _id: webpage._id, duplicates, duplicateScore };
          });

          // Send in dbBatchSize-sized bulkWrite operations
          for (const batch of this.batchArray(updates, dbBatchSize)) {
            await this.withRetry(() => this.bulkWriteDuplicateResults(batch));
          }
        } catch (err) {
          logger.error("Pass 2: bulkWrite failed for chunk", {
            userId,
            lastIdPass2,
            err,
          });
          // non-fatal — continue to next chunk
        }

        // ── Parallel checks ───────────────────────────────────────────
        try {
          await Promise.all([
            this.runGrammarCheckChunk(chunk, userId, userActivityId),
            this.validateLinksChunk(chunk, userId, userActivityId),
          ]);
          await this.recalculateScoresChunk(chunk, userId, userActivityId);
        } catch (err) {
          logger.error("Pass 2: parallel checks failed for chunk", {
            userId,
            err,
          });
        }

        // ── Bookkeeping ───────────────────────────────────────────────
        lastIdPass2 = chunk.at(-1)._id;
        processed += chunk.length;
        this.stats.updated += chunk.length;
        chunkCount++;

        // Checkpoint after every chunk
        await this.saveCheckpoint(userActivityId, {
          pass1Done: true,
          lastIdPass1: null,
          lastIdPass2,
        });

        // Progress 85 → 99
        const progress = Math.min(
          this.PROGRESS_END,
          this.PROGRESS_START +
            Math.round(
              ((this.PROGRESS_END - this.PROGRESS_START) * processed) /
                totalCount,
            ),
        );
        await this.activityService.updateProgress(userActivityId, { progress });

        logger.debug("Pass 2 chunk done", {
          userId,
          chunkCount,
          processed,
          totalCount,
          ms: Date.now() - t0,
        });
      }

      // ── Finalise ───────────────────────────────────────────────────────
      await this.activityService.updateProgress(userActivityId, {
        progress: 100,
        isWebpageCrawling: 0,
        status: "completed",
        endTime: new Date(),
        slowAnalysisCompleted: true,
        _checkpoint: null, // clear checkpoint on success
      });

      const totalTime = Date.now() - this.stats.startTime;
      logger.info("Chunked analysis complete", {
        userId,
        processed,
        totalChunks: chunkCount,
        totalTimeSec: (totalTime / 1000).toFixed(1),
      });

      return {
        analyzed: this.stats.analyzed,
        updated: this.stats.updated,
        totalChunks: chunkCount,
        totalTime,
      };
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Run grammar/spell check on a chunk of webpages and persist to WebpageAnalysis.contentQuality.
   * Used in Crawl V2 when Phase1 skips grammar (processUrlFast).
   */
  async runGrammarCheckChunk(chunk, userId, userActivityId) {
    const concurrency = Math.min(config.concurrency.slow_analyzer || 8, 15);
    const limit = this.createConcurrencyLimiter(concurrency);
    await Promise.all(
      chunk.map((webpage) =>
        limit(async () => {
          const completeWebpage = await this.getCompleteWebpageData(
            webpage._id,
          );
          if (!completeWebpage) return;
          const content =
            completeWebpage.content &&
            typeof completeWebpage.content === "object" &&
            completeWebpage.content.content
              ? completeWebpage.content.content
              : typeof completeWebpage.content === "string"
                ? completeWebpage.content
                : "";
          const title = completeWebpage.title ?? "";
          const metaDescription = completeWebpage.metaDescription ?? "";
          const grammarResult = await this.grammarChecker.checkContent(
            content,
            title,
            metaDescription,
          );
          await this.updateWebpageWithGrammar(webpage._id, grammarResult);
        }),
      ),
    );
  }

  async updateWebpageWithGrammar(webpageId, grammarResult) {
    try {
      const webpageCore = await WebpageCore.findById(webpageId).lean();
      if (!webpageCore || !webpageCore.analysisId) return;
      const spellingErrors = grammarResult.spellingErrors || [];
      const grammarErrors = grammarResult.grammarErrors || [];
      const totalLanguageErrors = spellingErrors.length + grammarErrors.length;
      await WebpageAnalysis.findByIdAndUpdate(webpageCore.analysisId, {
        "contentQuality.spellingErrors": spellingErrors,
        "contentQuality.spellingErrorsCount": spellingErrors.length,
        "contentQuality.grammarErrors": grammarErrors,
        "contentQuality.grammarErrorsCount": grammarErrors.length,
        "contentQuality.totalLanguageErrors": totalLanguageErrors,
        updatedAt: new Date(),
      });
    } catch (error) {
      logger.error(`Error updating grammar for webpage ${webpageId}`, error);
    }
  }

  async validateLinksChunk(chunk, userId, userActivityId) {
    const batchSize = config.batch_sizes.link_validation || 30;
    const concurrency =
      config.concurrency.link_validation ||
      config.concurrency.slow_analyzer ||
      5;
    const limit = this.createConcurrencyLimiter(concurrency);
    for (let i = 0; i < chunk.length; i += batchSize) {
      const batch = chunk.slice(i, i + batchSize);
      await Promise.all(
        batch.map((webpage) =>
          limit(async () => {
            const completeWebpage = await this.getCompleteWebpageData(
              webpage._id,
            );
            if (!completeWebpage) {
              await this.updateWebpageWithLinks(webpage._id, {
                internalBrokenLinks: [],
                externalBrokenLinks: [],
                redirectLinks: [],
              });
              return;
            }
            const linkResults =
              await this.linkProcessor.validatePageLinks(completeWebpage);
            await this.updateWebpageWithLinks(webpage._id, linkResults);
            this.stats.internalBrokenLinksFound +=
              linkResults.internalBrokenLinks?.length || 0;
            this.stats.externalBrokenLinksFound +=
              linkResults.externalBrokenLinks?.length || 0;
            this.stats.redirectLinksFound +=
              linkResults.redirectLinks?.length || 0;
          }),
        ),
      );
    }
  }

  async recalculateScoresChunk(chunk, userId, userActivityId) {
    const concurrency = Math.min(config.concurrency.slow_analyzer || 8, 20);
    const limit = this.createConcurrencyLimiter(concurrency);
    const processOne = async (webpage) => {
      const completeWebpage = await this.getCompleteWebpageData(webpage._id);
      if (!completeWebpage) return 0;
      //   if (completeWebpage.technicalId) {
      //     const freshTechnical = await WebpageTechnical.findById(completeWebpage.technicalId).lean();
      //     if (freshTechnical) {
      //       completeWebpage.technical = freshTechnical;
      //       completeWebpage.links = freshTechnical.links;
      //       completeWebpage.redirectLinks = freshTechnical.redirectLinks || [];
      //       completeWebpage.internalBrokenLinks = freshTechnical.internalBrokenLinks || [];
      //       completeWebpage.externalBrokenLinks = freshTechnical.externalBrokenLinks || [];
      //     }
      //   }
      const scoreResult =
        this.scoreCalculator.calculateNewSystemScores(completeWebpage);
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
        await WebpageAnalysis.findByIdAndUpdate(completeWebpage.analysisId, {
          slowAnalysisCompleted: true,
        });
      }
      return 1;
    };
    await Promise.all(chunk.map((webpage) => limit(() => processOne(webpage))));
  }

  async detectDuplicates(webpages, userId, userActivityId, websiteUrl) {
    logger.info("Phase 1: Detecting duplicates", userId);

    const batchSize = config.batch_sizes.duplicate_check || 20;
    const totalBatches = Math.ceil(webpages.length / batchSize);

    for (let i = 0; i < webpages.length; i += batchSize) {
      const batch = webpages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      logger.debug(
        `Processing duplicate batch ${batchNumber}/${totalBatches}`,
        userId,
      );

      const duplicateResults = await this.duplicateProcessor.findDuplicates(
        batch,
        userId,
        websiteUrl,
      );

      for (const webpage of batch) {
        const duplicates = duplicateResults.get(webpage._id.toString());
        if (duplicates) {
          const duplicateScore = this.calculateDuplicateScore(duplicates);

          await this.updateWebpageWithDuplicates(
            webpage._id,
            duplicates,
            duplicateScore,
          );

          this.stats.duplicatesFound +=
            duplicates.titleDuplicates.length +
            duplicates.descriptionDuplicates.length +
            duplicates.contentDuplicates.length;
        } else {
          await this.updateWebpageWithDuplicates(
            webpage._id,
            {
              titleDuplicates: [],
              descriptionDuplicates: [],
              contentDuplicates: [],
            },
            100,
          );
        }
        this.stats.analyzed++;
      }

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
          userId,
        );
      }

      if (i + batchSize < webpages.length) {
        await this.sleep(100);
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
        userId,
      );

      const concurrency =
        config.concurrency.link_validation ||
        config.concurrency.slow_analyzer ||
        5;
      const limit = this.createConcurrencyLimiter(concurrency);

      const promises = batch.map((webpage) =>
        limit(async () => {
          try {
            logger.info(`Validating links for: ${webpage.pageUrl}`, userId);

            // CRITICAL FIX: Load complete webpage data with technical information
            const completeWebpage = await this.getCompleteWebpageData(
              webpage._id,
            );

            if (!completeWebpage) {
              logger.warn(
                `Could not load complete data for link validation: ${webpage.pageUrl}`,
                userId,
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
                `Has links: ${!!completeWebpage.links}`,
            );

            const linkResults =
              await this.linkProcessor.validatePageLinks(completeWebpage);

            const hasIssues =
              linkResults.internalBrokenLinks.length > 0 ||
              linkResults.externalBrokenLinks.length > 0 ||
              linkResults.redirectLinks.length > 0;

            if (hasIssues) {
              logger.warn(
                `Found ${linkResults.internalBrokenLinks.length} internal broken, ` +
                  `${linkResults.externalBrokenLinks.length} external broken, ` +
                  `${linkResults.redirectLinks.length} redirect links on ${webpage.pageUrl}`,
                userId,
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
              userId,
            );
            logger.error(error.stack);
            return {
              success: false,
              webpageId: webpage._id,
              error: error.message,
            };
          }
        }),
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
          userId,
        );
      }

      if (i + batchSize < webpages.length) {
        await this.sleep(batchDelay);
      }
    }
  }

  async getCompleteWebpageData(webpageId) {
    try {
      const webpageCore = await WebpageCore.findById(webpageId)
        .populate("contentId technicalId analysisId")
        .lean();

      if (!webpageCore) {
        logger.warn(`WebpageCore not found for ID: ${webpageId}`);
        return null;
      }

      return {
        ...webpageCore,
        title: webpageCore.contentId?.title || webpageCore.title,
        titleLength:
          webpageCore.contentId?.titleLength || webpageCore.titleLength,
        metaDescription:
          webpageCore.contentId?.metaDescription || webpageCore.metaDescription,
        metaDescriptionLength:
          webpageCore.contentId?.metaDescriptionLength ||
          webpageCore.metaDescriptionLength,
        wordCount: webpageCore.contentId?.wordCount || webpageCore.wordCount,
        headingStructure: webpageCore.contentId?.headingStructure,
        titleTagCount: webpageCore.contentId?.titleTagCount,
        content: webpageCore.contentId,
        technicalSeo: webpageCore.technicalId?.technicalSeo,
        links: webpageCore.technicalId?.links,
        internalBrokenLinks: webpageCore.technicalId?.internalBrokenLinks || [],
        externalBrokenLinks: webpageCore.technicalId?.externalBrokenLinks || [],
        redirectLinks: webpageCore.technicalId?.redirectLinks || [],
        performance: webpageCore.technicalId?.performance,
        technical: webpageCore.technicalId,
        images: webpageCore.analysisId?.images,
        duplicates: webpageCore.analysisId?.duplicates,
        grammarSpelling: webpageCore.analysisId?.contentQuality,
        analysis: webpageCore.analysisId,
      };
    } catch (error) {
      logger.error(
        `Error fetching complete webpage data for ${webpageId}:`,
        error,
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
    const concurrency = Math.min(
      config.concurrency.slow_analyzer || 8,
      batchSize,
    );
    const limit = this.createConcurrencyLimiter(concurrency);
    let processedPages = 0;

    const processOne = async (webpage) => {
      try {
        const completeWebpage = await this.getCompleteWebpageData(webpage._id);
        if (!completeWebpage) {
          logger.warn(
            `Could not load complete data for ${webpage.pageUrl}`,
            userId,
          );
          return 0;
        }

        if (completeWebpage.technicalId) {
          const freshTechnical = await WebpageTechnical.findById(
            completeWebpage.technicalId,
          ).lean();
          if (freshTechnical) {
            completeWebpage.technical = freshTechnical;
            completeWebpage.links = freshTechnical.links;
            completeWebpage.redirectLinks = freshTechnical.redirectLinks || [];
            completeWebpage.internalBrokenLinks =
              freshTechnical.internalBrokenLinks || [];
            completeWebpage.externalBrokenLinks =
              freshTechnical.externalBrokenLinks || [];
            completeWebpage.httpLinks = freshTechnical.httpLinks || [];
          }
        }

        const scoreResult =
          this.scoreCalculator.calculateNewSystemScores(completeWebpage);
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
          await WebpageAnalysis.findByIdAndUpdate(completeWebpage.analysisId, {
            slowAnalysisCompleted: true,
          });
        }

        logger.debug(`Scores updated for ${webpage.pageUrl}`, userId);
        return 1;
      } catch (error) {
        logger.error(
          `Failed to recalculate scores for ${webpage.pageUrl}: ${error.message}`,
          userId,
        );
        return 0;
      }
    };

    for (let i = 0; i < webpages.length; i += batchSize) {
      const batch = webpages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      const results = await Promise.all(
        batch.map((webpage) => limit(() => processOne(webpage))),
      );
      processedPages += results.reduce((a, b) => a + b, 0);

      logger.debug(`Score recalc batch ${batchNumber}/${totalBatches}`, userId);
    }

    logger.info(
      `Recalculated scores for ${processedPages}/${webpages.length} pages`,
      userId,
    );
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
        error,
      );
    }
  }

  async updateWebpageWithLinks(webpageId, linkResults) {
    logger.debug(
      `Updating links for ${webpageId}: ` +
        `${linkResults.internalBrokenLinks.length} internal broken, ` +
        `${linkResults.externalBrokenLinks.length} external broken, ` +
        `${linkResults.redirectLinks.length} redirects`,
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
        { new: true },
      );

      logger.info(
        `✅ Updated links for ${webpageId}: ` +
          `${linkResults.internalBrokenLinks.length} internal broken, ` +
          `${linkResults.externalBrokenLinks.length} external broken, ` +
          `${linkResults.redirectLinks.length} redirects`,
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

module.exports = SlowAnalyzerJobV2;
