# webCrawler — In-Depth Pseudo Code

High-level flow: **webCrawler** → **scraperService.processWebsite** → **jobManager.processWebsite** → (sitemaps → fast scrape → slow analysis) → activity & socket updates.

---

## 1. webCrawler(websiteUrl, sitemapUrls?, userId, concurrency?)

```
FUNCTION webCrawler(websiteUrl, sitemapUrls, userId, concurrency = 15):
  startTime = NOW()
  userActivity = NULL

  TRY
    // ---------- 1. VALIDATION & NORMALIZATION ----------
    urlValidation = ValidationUtils.validateUrl(websiteUrl)
    IF NOT urlValidation.isValid:
      THROW Error(urlValidation.errors[0] OR "Invalid website URL")

    validConcurrency = CLAMP(parseInt(concurrency) OR 15, 5, 25)
    cleanUrl = urlValidation.normalizedUrl
    IF cleanUrl CONTAINS "://www.":
      cleanUrl = REPLACE(cleanUrl, "://www.", "://")

    // ---------- 2. SCRAPER SERVICE INIT ----------
    IF NOT scraperService.initialized:
      AWAIT scraperService.initialize()
      // (DB init, crash recovery, stalled-job monitor, periodic tasks, shutdown handlers)

    // ---------- 3. SITEMAP URL RESOLUTION ----------
    finalSitemapUrls = sitemapUrls
    IF finalSitemapUrls IS EMPTY:
      validation = AWAIT scraperService.validateWebsite(cleanUrl)
      IF NOT validation.isValid:
        THROW Error(validation.message)
      IF validation.sitemapUrls IS EMPTY:
        THROW Error("No sitemaps found. Please provide sitemap URLs manually.")
      finalSitemapUrls = validation.sitemapUrls
      // validateWebsite: if URL is sitemap → validateSitemapUrl; else → validateWebsiteUrl
      //   validateWebsiteUrl: HEAD request, findSitemap(robots.txt + common paths), return sitemapUrls

    // ---------- 4. EXISTING ACTIVITY & STALL CHECK ----------
    existingActivity = AWAIT UserActivity.findOne({ userId, websiteUrl: cleanUrl })

    IF existingActivity AND status IN ["processing", "analyzing"]:
      timeSinceHeartbeat = NOW() - (existingActivity.lastHeartbeat OR existingActivity.lastUpdated OR NOW())
      IF timeSinceHeartbeat > 30_000 OR existingActivity.isStalled:
        // Stalled: mark as failed and allow new crawl
        AWAIT UserActivity.findByIdAndUpdate(existingActivity._id, {
          status: "failed", endTime: NOW(), errorMessages: [..., "Restarted after stall"],
          isSitemapCrawling: 0, isWebpageCrawling: 0, isStalled: true
        })
        existingActivity = NULL
      ELSE:
        // Still active: return "already in progress"
        RETURN {
          success: false, message: "Website scraping is already in progress",
          status, activityId, progress, crawlCount, isCurrentlyCrawling, sitemapCrawling, webpageCrawling
        }

    // ---------- 5. CREATE OR RESET USER ACTIVITY ----------
    IF NOT existingActivity:
      userActivity = NEW UserActivity({
        userId, websiteUrl: cleanUrl, status: "processing", startTime: NOW(), lastCrawlStarted: NOW(),
        lastHeartbeat: NOW(), progress: 0, crawlCount: 1, isSitemapCrawling: 1, isWebpageCrawling: 0,
        sitemapCount: LEN(finalSitemapUrls), webpageCount: 0, webpagesSuccessful: 0, webpagesFailed: 0,
        errorMessages: [], concurrency: validConcurrency, lastUpdated: NOW(),
        fastScrapingCompleted: false, slowAnalysisCompleted: false,
        serverInstance: crashRecoveryService.getInstanceId(), isStalled: false, crashRecovered: false
      })
    ELSE:
      userActivity = existingActivity
      SET userActivity: status = "processing", lastCrawlStarted = NOW(), lastHeartbeat = NOW(),
          progress = 0, crawlCount += 1, isSitemapCrawling = 1, isWebpageCrawling = 0,
          sitemapCount = LEN(finalSitemapUrls), webpageCount = 0, webpagesSuccessful = 0, webpagesFailed = 0,
          errorMessages = [], concurrency = validConcurrency, endTime = undefined, lastUpdated = NOW(),
          fastScrapingCompleted = false, slowAnalysisCompleted = false,
          serverInstance = crashRecoveryService.getInstanceId(), isStalled = false, crashRecovered = false

    AWAIT userActivity.save()

    // ---------- 6. PROCESSING OPTIONS ----------
    processingOptions = {
      concurrency: { fast_scraper: validConcurrency, slow_analyzer: CEIL(validConcurrency/3), sitemap_processing: MIN(3, validConcurrency) },
      timeouts: { request: 10000, sitemap: 15000 },
      realTimeUpdates: true
    }

    // ---------- 7. SOCKET: CRAWL STARTED ----------
    emitToUser(userId, "crawl_started", {
      activityId: userActivity._id, websiteUrl: cleanUrl, status: "processing",
      sitemapCount: LEN(finalSitemapUrls), crawlCount: userActivity.crawlCount,
      concurrency: validConcurrency, message: "Scraping started successfully", timestamp
    })

    // ---------- 8. CORE PROCESSING (BLOCKING UNTIL DONE) ----------
    TRY
      result = AWAIT scraperService.processWebsite(
        finalSitemapUrls, userId, userActivity._id.toString(), cleanUrl, processingOptions
      )
      // (see Section 2: processWebsite → jobManager.processWebsite)

      wasStoppedByUser = result.stoppedByUser OR false
      finalStatus = IF wasStoppedByUser THEN "stopped" ELSE "completed"
      totalFailed = result.fastResults.failed + (result.cleanupResults?.updated OR 0)

      // ---------- 9. UPDATE USER ACTIVITY (SUCCESS/STOPPED) ----------
      AWAIT UserActivity.findByIdAndUpdate(userActivity._id, {
        status: finalStatus, progress: IF wasStoppedByUser THEN userActivity.progress ELSE 100,
        endTime: NOW(), webpageCount: result.totalUrls, webpagesSuccessful: result.fastResults.successful,
        webpagesFailed: totalFailed, totalProcessingTime: result.processingTime,
        fastScrapingCompleted: NOT wasStoppedByUser, slowAnalysisCompleted: result.slowAnalysisCompleted OR false,
        isSitemapCrawling: 0, isWebpageCrawling: 0, lastUpdated: NOW(), lastHeartbeat: NOW(),
        fastScrapingResults: { totalUrls, successful, failed, incompleteMarkedFailed, processingTime },
        slowAnalysisResults: result.slowResults ? { analyzed, updated, duplicatesFound, brokenLinksFound, processingTime } : NULL
      })

      // ---------- 10. USER PLAN USAGE ----------
      TRY
        userPlan = AWAIT UserPlan.findOne({ userId })
        IF userPlan AND result.totalUrls > 0:
          AWAIT userPlan.incrementUsage("webCrawler", "pages", result.totalUrls)
      CATCH planErr:
        LOG ERROR "Failed to update user plan usage after crawl"

      // ---------- 11. SOCKET: CRAWL COMPLETED ----------
      emitToUser(userId, "crawl_completed", {
        activityId, websiteUrl: cleanUrl, status: finalStatus,
        totalSitemaps: result.sitemaps, totalWebpages: result.totalUrls,
        savedPages: result.fastResults.successful, failedPages: totalFailed,
        incompletePages: result.cleanupResults?.updated OR 0, processingTime: result.processingTime,
        message: (stopped vs completed message), slowAnalysisCompleted, stoppedByUser, timestamp
      })
      AWAIT emitUserActivitiesUpdate(userId)

      RETURN { success: true, message: "Scraping started successfully", activityId, status: "processing",
              websiteUrl: cleanUrl, sitemapCount, crawlCount, lastCrawlStarted, concurrency, processingTime }

    CATCH error  // processing error (inside try block)
      isRateLimited = (error.message CONTAINS "Rate limited")
      finalStatus = IF isRateLimited THEN "rate_limited" ELSE "failed"
      LOG ERROR "Background processing failed"
      incompleteCount = AWAIT webpageService.getIncompleteWebpagesCount(userActivity._id)
      AWAIT UserActivity.findByIdAndUpdate(userActivity._id, {
        status: finalStatus, endTime: NOW(), errorMessages: [error.message],
        isSitemapCrawling: 0, isWebpageCrawling: 0, lastUpdated: NOW(), lastHeartbeat: NOW()
      })
      emitToUser(userId, "crawl_error", { websiteUrl: cleanUrl, message: error.message, activityId, isRateLimited, incompletePagesCleaned: incompleteCount, timestamp })
      AWAIT emitUserActivitiesUpdate(userId)
      THROW error  // so BullMQ marks job failed

  CATCH error  // top-level (validation, activity creation, etc.)
    LOG ERROR "Error in webCrawler"
    IF userActivity:
      AWAIT UserActivity.findByIdAndUpdate(userActivity._id, { status: "failed", endTime: NOW(), errorMessages: [error.message], isSitemapCrawling: 0, isWebpageCrawling: 0, lastUpdated: NOW() })
      AWAIT emitUserActivitiesUpdate(userId)
    THROW Error(error.message)
```

---

## 2. scraperService.processWebsite(sitemapUrls, userId, activityId, websiteUrl, options)

```
FUNCTION processWebsite(sitemapUrls, userId, activityId, websiteUrl, options):
  ensureInitialized()
  IF sitemapUrls NOT array OR EMPTY: THROW Error("No sitemap URLs provided")
  IF NOT userId: THROW Error("User ID is required")
  result = AWAIT jobManager.processWebsite(sitemapUrls, userId, activityId, websiteUrl, options)
  RETURN result
```

---

## 3. jobManager.processWebsite(sitemapUrls, userId, activityId, websiteUrl, options)

```
jobId = "${userId}_${activityId}"

TRY
  stats.totalJobs++; stats.activeJobs++
  activeJobs.set(jobId, { userId, activityId, websiteUrl, startTime: NOW(), status: "starting", fastScraperJob: NULL })
  AWAIT crashRecoveryService.markActivityAsActive(activityId, jobId)
  startHeartbeat(activityId, jobId)   // every 5s: crashRecoveryService.updateHeartbeat(activityId)

  // ---------- PHASE 1: SITEMAPS ----------
  activeJobs.get(jobId).status = "processing_sitemaps"
  sitemapResult = AWAIT sitemapService.processSitemapsAndSaveUrls(sitemapUrls, activityId, userId)
  allUrls = sitemapResult.extractedUrls
  IF allUrls EMPTY: THROW Error("No URLs found in sitemaps")

  // ---------- PHASE 2: FAST SCRAPING ----------
  activeJobs.get(jobId).status = "fast_scraping"
  fastScraperJob = NEW FastScraperJob()
  activeJobs.get(jobId).fastScraperJob = fastScraperJob
  fastResults = AWAIT fastScraperJob.processWebpages(allUrls, userId, activityId, websiteUrl)

  IF fastScraperJob.scraper.shouldStop OR fastResults.stopped:
    activeJobs.get(jobId).status = "stopped"; stats.activeJobs--
    stopHeartbeat(jobId)
    cleanupResult = AWAIT cleanupIncompleteWebpages(activityId, userId, "Scraping stopped by user")
    activeJobs.delete(jobId)
    RETURN { jobId, totalUrls: LEN(allUrls), sitemaps, sitemapStats: sitemapResult, fastResults, cleanupResults, processingTime, slowAnalysisCompleted: false, stoppedByUser: true }

  // ---------- PHASE 3: SLOW ANALYSIS ----------
  activeJobs.get(jobId).status = "slow_analysis"
  slowAnalyzerJob = NEW SlowAnalyzerJob()
  slowResults = AWAIT slowAnalyzerJob.analyzeWebpages(userId, activityId, websiteUrl)

  activeJobs.get(jobId).status = "completed"; stats.completedJobs++; stats.activeJobs--
  stopHeartbeat(jobId)
  activeJobs.delete(jobId)
  RETURN { jobId, totalUrls, sitemaps, sitemapStats, fastResults, slowResults, processingTime, slowAnalysisCompleted: true }

CATCH error
  stats.failedJobs++; stats.activeJobs--
  stopHeartbeat(jobId)
  AWAIT cleanupIncompleteWebpages(activityId, userId, "Job failed: " + error.message)
  activeJobs.get(jobId).status = "failed"; activeJobs.get(jobId).error = error.message
  AFTER 5s: activeJobs.delete(jobId)
  THROW error
```

---

## 4. sitemapService.processSitemapsAndSaveUrls(sitemapUrls, activityId, userId)

```
  IF sitemapUrls EMPTY: THROW Error("No sitemaps found to process")

  // Step 0: Validate each sitemap URL (checkSitemapExists)
  validSitemaps = []
  FOR url IN sitemapUrls:
    IF AWAIT checkSitemapExists(url): validSitemaps.push(url)
  IF validSitemaps EMPTY: THROW Error("No valid XML sitemaps found")

  // Step 1: Persist sitemap records
  sitemapIds = AWAIT saveSitemapsToDb(validSitemaps, activityId, userId)

  // Step 2: Fetch sitemap XMLs and extract <loc> URLs (dedupe, normalize, limit)
  extractedUrls = AWAIT extractUrlsFromSitemaps(validSitemaps, userId)
  IF extractedUrls EMPTY:
    AWAIT updateSitemapStatuses(sitemapIds, 3, userId, "No URLs found in sitemap(s)")
    THROW Error("No URLs found in sitemaps")

  // Step 3: Save URL list for activity (e.g. for reference / reporting)
  savedUrlCount = AWAIT saveWebpageUrlsToDb(extractedUrls, activityId, userId)

  // Step 4: Mark sitemaps as processed
  AWAIT updateSitemapStatuses(sitemapIds, 2, userId)

  RETURN { sitemapIds, extractedUrls, savedUrlCount, totalSitemaps: LEN(validSitemaps), totalUrls: LEN(extractedUrls), skippedSitemaps }
```

---

## 5. fastScraperJob.processWebpages(urls, userId, userActivityId, websiteUrl)

```
  stats.startTime = NOW(); resetStats()
  batchSize = config.batch_sizes.fast_scrape
  totalBatches = CEIL(LEN(urls) / batchSize)

  TRY
    FOR i = 0 TO LEN(urls)-1 STEP batchSize:
      IF scraper.shouldStop:
        AWAIT cleanupIncompleteWebpages(userActivityId, userId)
        BREAK
      batch = urls[i : i+batchSize]
      batchResults = AWAIT processBatch(batch, userId, userActivityId, websiteUrl)
      stats.successful += batchResults.successful; stats.failed += batchResults.failed; stats.processed += LEN(batch)
      progressPercent = ROUND((stats.processed / LEN(urls)) * 80)
      AWAIT activityService.updateProgress(userActivityId, { progress: progressPercent, webpageCount, webpagesSuccessful, webpagesFailed, isWebpageCrawling: 1, isSitemapCrawling: 0 })
      IF i + batchSize < LEN(urls): SLEEP(200)

    IF scraper.shouldStop:
      AWAIT activityService.updateProgress(..., fastScrapingCompleted: false, isWebpageCrawling: 0)
      RETURN { successful, failed, total: LEN(urls), stopped: true }

    AWAIT activityService.updateProgress(userActivityId, { progress: 85, ..., fastScrapingCompleted: true, isWebpageCrawling: 0 })
    RETURN { successful, failed, total: LEN(urls), avgTime, totalTime }
  CATCH error
    AWAIT cleanupIncompleteWebpages(userActivityId, userId)
    THROW error
```

---

## 6. fastScraperJob.processBatch(urls, userId, userActivityId, websiteUrl)

```
  concurrency = config.concurrency.fast_scraper
  limit = createConcurrencyLimiter(concurrency)   // p-limit style
  successful = 0; failed = 0

  promises = urls.MAP(url =>
    limit(async () => {
      TRY
        result = AWAIT processUrl(url, userId, userActivityId, websiteUrl)
        IF result.success: successful++; ELSE failed++
        RETURN result
      CATCH: failed++; RETURN { success: false, url, error }
    })
  )
  AWAIT Promise.all(promises)
  RETURN { successful, failed }
```

---

## 7. fastScraperJob.processUrl(url, userId, userActivityId, websiteUrl)

```
  IF scraper.shouldStop: THROW Error("Scraping stopped by user")

  // 7a. Fetch page (via proxy/scraper)
  scrapedData = AWAIT scrapeWebpageViaProxy(url, { timeout: config.timeouts.standard_request })
  // scrapeWebpageViaProxy: calls scraper.scrapeWebpage(url) [core scraper: HTTP via proxy, parse HTML with cheerio, extract title/meta/content/headings/images/links/technicalSeo/wordCount/statusCode/etc.]

  // 7b. Grammar/spelling check
  spellingIssues = AWAIT grammarChecker.checkContent(scrapedData.content, scrapedData.title, scrapedData.metaDescription)

  // 7c. Score (20-point system; overall not written to core until slow analysis)
  scores = scoreCalculator.calculateFastScores(scrapedData, spellingIssues)
  // calculateFastScores: calls calculateNewSystemScores({ ...scrapedData, grammarSpelling }), maps to legacy shape, legacyScores.overall = newResult.totalScore

  // 7d. Build payload
  webpageData = prepareWebpageData(scrapedData, scores, spellingIssues, userId, userActivityId, websiteUrl)
  // (core + content + technical + analysis + scores shape; duplicates/broken links empty; slowAnalysisCompleted: false)

  // 7e. Persist (upsert core + content + technical + analysis + scores; only write seoScore/seoGrade to core if slowAnalysisCompleted)
  savedWebpage = AWAIT webpageService.upsertWebpage(webpageData, userId, websiteUrl, url)

  IF savedWebpage: RETURN { success: true, url, webpageId: savedWebpage._id }
  ELSE:
    AWAIT saveFailedWebpage(url, userId, userActivityId, websiteUrl, "Failed to save to database")
    RETURN { success: false, url, error: "Failed to save to database" }
  CATCH error
    AWAIT saveFailedWebpage(url, userId, userActivityId, websiteUrl, error.message)
    RETURN { success: false, url, error: error.message }
```

---

## 8. slowAnalyzerJob.analyzeWebpages(userId, userActivityId, websiteUrl)

```
  stats.startTime = NOW(); resetStats()
  AWAIT activityService.updateProgress(userActivityId, { progress: 85, isWebpageCrawling: 2, status: "analyzing" })

  webpages = AWAIT getWebpagesForAnalysis(userActivityId)
  // WebpageCore.find({ userActivityId, slowAnalysisCompleted != true, hasErrors != true, isProcessed: true })
  failedPagesCount = AWAIT getFailedPagesCount(userActivityId)
  IF webpages EMPTY: RETURN { analyzed: 0, updated: 0, failedPages: failedPagesCount }

  // Phase 1: Duplicates
  AWAIT detectDuplicates(webpages, userId, userActivityId, websiteUrl)
  // duplicateProcessor.findDuplicates(batch) → for each page update WebpageCore/WebpageAnalysis/WebpageContent with duplicate data and duplicateScore
  AWAIT updateProgressAndNotify(userId, userActivityId, 90, "Duplicate analysis completed")

  // Phase 2: Link validation
  AWAIT validateLinks(webpages, userId, userActivityId)
  // linkProcessor.validateLinks → head/fetch; update WebpageTechnical with internalBrokenLinks, externalBrokenLinks, redirectLinks
  AWAIT updateProgressAndNotify(userId, userActivityId, 95, "Link validation completed")

  // Phase 3: Recalculate scores
  AWAIT recalculateScores(webpages, userId, userActivityId)
  // For each page: getCompleteWebpageData (core+content+technical+analysis+scores); refresh technical links; scoreCalculator.calculateNewSystemScores(completeWebpage); update WebpageCore (seoScore, seoGrade, slowAnalysisCompleted: true) and WebpageScores
  AWAIT updateProgressAndNotify(userId, userActivityId, 100, "Score recalculation completed")

  AWAIT activityService.updateProgress(userActivityId, { progress: 100, isWebpageCrawling: 0, status: "completed", endTime: NOW(), slowAnalysisCompleted: true })
  RETURN { analyzed, updated, duplicatesFound, internalBrokenLinksFound, externalBrokenLinksFound, redirectLinksFound, failedPages: failedPagesCount, totalTime }
  CATCH error
    AWAIT activityService.updateProgress(userActivityId, { status: "failed", endTime: NOW(), errorMessages: [error.message] })
    THROW error
```

---

## 9. Data flow summary

| Stage              | Input                    | Output / Side effects |
|--------------------|--------------------------|------------------------|
| webCrawler         | websiteUrl, userId, …    | UserActivity created/updated; socket crawl_started; calls processWebsite |
| validateWebsite    | websiteUrl               | HEAD + findSitemap → sitemapUrls or error |
| processSitemaps    | sitemapUrls, activityId  | Sitemap records + extractedUrls (list of page URLs) |
| processWebpages    | allUrls, activityId      | Batched processUrl; activity progress 0→80%; WebpageCore/Content/Technical/Analysis/Scores (no final seoScore on core) |
| processUrl         | single url               | Scrape → grammar → scores → prepareWebpageData → upsertWebpage |
| analyzeWebpages    | activityId               | Duplicates → links → recalculateScores; WebpageCore.seoScore/seoGrade + slowAnalysisCompleted: true |
| jobManager return  | —                        | totalUrls, fastResults, slowResults, processingTime, slowAnalysisCompleted, stoppedByUser? |
| webCrawler success | result                   | UserActivity final status/progress/counts; UserPlan usage; socket crawl_completed; emitUserActivitiesUpdate |

---

## 10. Concurrency and stop signal

- **Concurrency:** `validConcurrency` (5–25) used for fast_scraper; slow_analyzer uses `ceil(validConcurrency/3)`; sitemap uses `min(3, validConcurrency)`. Batches of `config.batch_sizes.fast_scrape` URLs; within a batch, up to `config.concurrency.fast_scraper` URLs in flight (p-limit).
- **Stop:** User calls stop endpoint → scraperService.stopCrawl(activityId) → jobManager.stopJob(activityId) sets `fastScraperJob.scraper.shouldStop = true`. Next batch check in processWebpages and processUrl sees it and exits or skips; cleanup marks incomplete webpages as failed.

This pseudo code reflects the current implementation; for exact behavior, refer to `scraperController.js` (webCrawler), `scraper-service.js` (processWebsite, validateWebsite), `job-manager.js` (processWebsite), `sitemap-service.js` (processSitemapsAndSaveUrls), `fast-scraper.js` (processWebpages, processBatch, processUrl), and `slow-analyzer.js` (analyzeWebpages).
