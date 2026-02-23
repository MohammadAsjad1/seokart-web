const {
  WebpageCore,
  WebpageContent,
  WebpageScores,
  WebpageTechnical,
  WebpageAnalysis,
  calculateSEOScore,
} = require("../models/webpage-models");
const logger = require("../config/logger");

class WebpageService {
  constructor() {
    this.stats = {
      documentsUpdated: 0,
      documentsCreated: 0,
      errors: 0,
      coreUpdated: 0,
      coreCreated: 0,
      contentUpdated: 0,
      contentCreated: 0,
      technicalUpdated: 0,
      technicalCreated: 0,
      analysisUpdated: 0,
      analysisCreated: 0,
      scoresUpdated: 0,
      scoresCreated: 0,
    };
  }

  // Main method to save complete webpage data
  async upsertCompleteWebpage(webpageData, userId, websiteUrl, pageUrl) {
    try {
      logger.debug(`Saving complete webpage data for: ${pageUrl}`, userId);

      // Step 1: Check if WebpageCore already exists
      const existingCore = await this.findExistingWebpageCore(
        webpageData.core?.userActivityId,
        pageUrl
      );

      let webpageCore;
      let isExistingCore = false;

      if (existingCore) {
        // Update existing core
        webpageCore = await this.updateWebpageCore(
          existingCore,
          webpageData.core,
          userId,
          websiteUrl,
          pageUrl
        );
        isExistingCore = true;
        logger.debug(
          `Found existing WebpageCore: ${existingCore._id}, updating all related collections`,
          userId
        );
      } else {
        // Create new core
        webpageCore = await this.createWebpageCore(
          webpageData.core,
          userId,
          websiteUrl,
          pageUrl
        );
        logger.debug(
          `Created new WebpageCore: ${webpageCore._id}, creating all related collections`,
          userId
        );
      }

      // Step 2: Update/Create all related collections using the core ID
      const results = {
        core: webpageCore,
        content: null,
        technical: null,
        analysis: null,
        scores: null,
      };

      // Update/Create WebpageContent
      if (webpageData.content) {
        results.content = await this.upsertWebpageContent(
          webpageData.content,
          webpageCore._id,
          isExistingCore
        );

        // Update core reference if new content was created
        if (results.content && !webpageCore.contentId) {
          await WebpageCore.findByIdAndUpdate(webpageCore._id, {
            contentId: results.content._id,
          });
        }
      }

      // Update/Create WebpageTechnical
      if (
        webpageData.technicalSeo ||
        webpageData.links ||
        webpageData.performance ||
        webpageData.brokenLinks
      ) {
        results.technical = await this.upsertWebpageTechnical(
          webpageData,
          webpageCore._id,
          isExistingCore
        );

        // Update core reference if new technical was created
        if (results.technical && !webpageCore.technicalId) {
          await WebpageCore.findByIdAndUpdate(webpageCore._id, {
            technicalId: results.technical._id,
          });
        }
      }

      // Update/Create WebpageAnalysis
      if (
        webpageData.duplicates ||
        webpageData.images ||
        webpageData.grammarSpelling
      ) {
        results.analysis = await this.upsertWebpageAnalysis(
          webpageData,
          webpageCore._id,
          isExistingCore
        );

        // Update core reference if new analysis was created
        if (results.analysis && !webpageCore.analysisId) {
          await WebpageCore.findByIdAndUpdate(webpageCore._id, {
            analysisId: results.analysis._id,
          });
        }
      }

      // Calculate and save SEO scores based on 20-point system
      results.scores = await this.calculateAndSaveScores(
        webpageCore._id,
        results,
        isExistingCore
      );

      // Update core reference if new scores were created.
      // Only write seoScore/seoGrade to core when slow analysis is done, so the UI never shows
      // a preliminary score that later drops (better UX).
      if (results.scores && !webpageCore.scoresId) {
        const coreUpdate = { scoresId: results.scores._id };
        if (webpageData.core?.slowAnalysisCompleted) {
          coreUpdate.seoScore = results.scores.seoScore;
          coreUpdate.seoGrade = results.scores.seoGrade;
        }
        await WebpageCore.findByIdAndUpdate(webpageCore._id, coreUpdate);
      }

      logger.debug(
        `Successfully ${
          isExistingCore ? "updated" : "created"
        } complete webpage: ${pageUrl}`,
        userId
      );

      return results;
    } catch (error) {
      console.log(error);
      this.stats.errors++;
      logger.error(`Error saving complete webpage ${pageUrl}`, error, userId);
      throw error;
    }
  }

  // Calculate SEO scores based on 20-point system (each 5%)
  async calculateAndSaveScores(webpageCoreId, results, isExistingCore) {
    try {
      const content = results.content;
      const technical = results.technical;
      const analysis = results.analysis;

      // Initialize all scores to 0 (fail)
      const scores = {
        // Point 1: Title should not be missing (5%)
        titleNotMissing:
          content && content.title && content.title.trim() ? 5 : 0,

        // Point 2: Title should be the right length (5%)
        titleRightLength: content && content.titleRightLength ? 5 : 0,

        // Point 3: Title should not be duplicated (5%)
        titleNotDuplicated: content && !content.titleDuplicated ? 5 : 0,

        // Point 4: Meta description should not be missing (5%)
        metaDescNotMissing:
          content && content.metaDescription && content.metaDescription.trim()
            ? 5
            : 0,

        // Point 5: Meta description should be the right length (5%)
        metaDescRightLength:
          content && content.metaDescriptionRightLength ? 5 : 0,

        // Point 6: Meta description should not be duplicated (5%)
        metaDescNotDuplicated:
          content && !content.metaDescriptionDuplicated ? 5 : 0,

        // Point 7: Content should not be too short (5%)
        contentNotTooShort: content && !content.contentTooShort ? 5 : 0,

        // Point 8: Page should not have multiple title tags (5%) - CHANGED
        noMultipleTitles: content && !content.multipleTitles ? 5 : 0,

        // Point 9: Headings should have one H1 only (5%)
        oneH1Only: content && content.oneH1Only ? 5 : 0,

        // Point 10: Headings should use H2/H3 in proper order (5%)
        headingsProperOrder: content && content.headingsProperOrder ? 5 : 0,

        // Point 11: URL should not be too long (5%)
        urlNotTooLong: content && !content.urlTooLong ? 5 : 0,

        // Point 12: Canonical tag should exist (5%)
        canonicalTagExists:
          technical && technical.technicalSeo?.canonicalTagExists ? 5 : 0,

        // Point 13: Internal links should exist in good numbers (5%)
        internalLinksGood:
          technical && technical.links?.internalCount >= 3 ? 5 : 0,

        // Point 14: External links should be balanced (5%)
        externalLinksBalanced:
          technical &&
          technical.links?.externalCount >= 1 &&
          technical.links?.externalCount <= 10
            ? 5
            : 0,

        // Point 15: Broken links should be avoided (5%)
        noInternalBrokenLinks:
          technical &&
          (technical.links?.internalBrokenLinksCount === 0 ||
            technical.internalBrokenLinks?.length === 0)
            ? 5
            : 0,

        noExternalBrokenLinks:
          technical &&
          (technical.links?.externalBrokenLinksCount === 0 ||
            technical.externalBrokenLinks?.length === 0)
            ? 5
            : 0,
        // Point 16: HTTP links should be avoided (5%)
        noHttpLinks: technical && technical.links?.httpLinksCount === 0 ? 5 : 0,

        // Point 17: Website should be fully mobile responsive (5%) - ENHANCED
        mobileResponsive: this.checkMobileResponsiveness(technical),

        // Point 18: Images should have alt text (5%)
        imagesHaveAltText:
          analysis && analysis.images?.altTextPercentage >= 90 ? 5 : 0,

        // Point 19: Content should not have grammar and spelling errors (5%) - CHANGED
        noGrammarSpellingErrors:
          analysis && analysis.contentQuality?.totalLanguageErrors === 0
            ? 5
            : 0,

        // Point 20: Content should not be duplicated (5%)
        contentNotDuplicated:
          analysis &&
          (!analysis.duplicates?.contentDuplicates ||
            analysis.duplicates.contentDuplicates.length === 0)
            ? 5
            : 0,
      };

      // Calculate total score and grade
      const { totalScore, grade } = calculateSEOScore(scores);

      // Save scores to database
      const scoresData = {
        webpageCoreId,
        seoScore: totalScore,
        seoGrade: grade,
        scores,
        lastCalculated: new Date(),
        calculationVersion: "3.0",
      };

      return await this.upsertWebpageScores(
        scoresData,
        webpageCoreId,
        isExistingCore
      );
    } catch (error) {
      logger.error(
        `Error calculating SEO scores for core ${webpageCoreId}`,
        error
      );
      throw error;
    }
  }

  // ENHANCED: Check mobile responsiveness with multiple factors
  checkMobileResponsiveness(technical) {
    if (!technical || !technical.performance) return 0;

    const hasViewport =
      technical.performance.hasViewportMeta ||
      technical.technicalSeo?.hasViewport ||
      false;
    const hasMediaQueries = technical.performance.hasMediaQueries || false;
    const isResponsive =
      technical.performance.isResponsiveDesign ||
      technical.performance.mobileResponsive ||
      false;

    // Need at least viewport and responsive design for mobile pass
    return hasViewport && isResponsive ? 5 : 0;
  }

  // Find existing WebpageCore by userActivityId and pageUrl
  async findExistingWebpageCore(userActivityId, pageUrl) {
    try {
      if (!userActivityId || !pageUrl) {
        return null;
      }

      const existingCore = await WebpageCore.findOne({
        pageUrl,
        userActivityId,
      });

      return existingCore;
    } catch (error) {
      logger.error(`Error finding existing WebpageCore for ${pageUrl}`, error);
      return null;
    }
  }

  // Create new WebpageCore
  async createWebpageCore(coreData, userId, websiteUrl, pageUrl) {
    try {
      const coreDataToSave = {
        userId,
        websiteUrl,
        pageUrl,
        userActivityId: coreData?.userActivityId,
        statusCode: coreData?.statusCode || 200,
        lastCrawled: new Date(),
        scrapedAt: new Date(),

        // Basic SEO scores (will be calculated later)
        seoScore: 0,
        seoGrade: "F",

        // Processing metadata
        processingMethod: coreData?.processingMethod || "nodejs_scraper",
        responseTime: coreData?.responseTime || 0,
        hasErrors: coreData?.hasErrors || false,
        isProcessed: coreData?.isProcessed || false,
        processedAt: coreData?.isProcessed ? new Date() : undefined,
        slowAnalysisCompleted: coreData?.slowAnalysisCompleted || false,

        // References (will be populated later)
        contentId: null,
        scoresId: null,
        technicalId: null,
        analysisId: null,

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newCore = new WebpageCore(coreDataToSave);
      const savedCore = await newCore.save();

      this.stats.coreCreated++;
      this.stats.documentsCreated++;
      logger.debug(
        `Created WebpageCore: ${pageUrl} for userActivityId: ${coreData?.userActivityId}`,
        userId
      );

      return savedCore;
    } catch (error) {
      logger.error(`Error creating WebpageCore for ${pageUrl}`, error);
      throw error;
    }
  }

  // Update existing WebpageCore
  async updateWebpageCore(existingCore, coreData, userId, websiteUrl, pageUrl) {
    try {
      const updateData = {
        userId,
        websiteUrl,
        pageUrl,
        statusCode: coreData?.statusCode || 200,
        lastCrawled: new Date(),
        scrapedAt: new Date(),

        // Processing metadata
        processingMethod: coreData?.processingMethod || "nodejs_scraper",
        responseTime: coreData?.responseTime || 0,
        hasErrors: coreData?.hasErrors || false,
        isProcessed: coreData?.isProcessed || false,
        processedAt: coreData?.isProcessed ? new Date() : undefined,
        slowAnalysisCompleted: coreData?.slowAnalysisCompleted || false,

        // Keep existing references and creation data
        contentId: existingCore.contentId,
        scoresId: existingCore.scoresId,
        technicalId: existingCore.technicalId,
        analysisId: existingCore.analysisId,
        createdAt: existingCore.createdAt,
        updatedAt: new Date(),
      };

      const updatedCore = await WebpageCore.findByIdAndUpdate(
        existingCore._id,
        updateData,
        { new: true, runValidators: true }
      );

      this.stats.coreUpdated++;
      this.stats.documentsUpdated++;
      logger.debug(
        `Updated WebpageCore: ${pageUrl} for userActivityId: ${coreData?.userActivityId}`,
        userId
      );

      return updatedCore;
    } catch (error) {
      logger.error(`Error updating WebpageCore for ${pageUrl}`, error);
      throw error;
    }
  }

  // Save/update WebpageContent
  async upsertWebpageContent(contentData, webpageCoreId, isExistingCore) {
    try {
      // Calculate boolean flags for the 20-point system
      const titleLength =
        contentData.titleLength ||
        (contentData.title ? contentData.title.length : 0);
      const metaDescLength =
        contentData.metaDescriptionLength ||
        (contentData.metaDescription ? contentData.metaDescription.length : 0);
      const wordCount = contentData.wordCount || 0;
      const urlLength = contentData.pageUrl ? contentData.pageUrl.length : 0;

      const contentDataToSave = {
        webpageCoreId,

        // Title data with new flags
        title: contentData.title || "",
        titleLength,
        titleMissing: !contentData.title || contentData.title.trim() === "",
        titleRightLength: titleLength >= 30 && titleLength <= 60,
        titleDuplicated: contentData.titleDuplicated || false,

        // Meta description data with new flags
        metaDescription: contentData.metaDescription || "",
        metaDescriptionLength: metaDescLength,
        metaDescriptionMissing:
          !contentData.metaDescription ||
          contentData.metaDescription.trim() === "",
        metaDescriptionRightLength:
          metaDescLength >= 120 && metaDescLength <= 160,
        metaDescriptionDuplicated:
          contentData.metaDescriptionDuplicated || false,

        // Content data with new flags
        content: contentData.content || "",
        wordCount,
        contentTooShort: wordCount < 300,

        // Point 8: Multiple title tags check - CHANGED
        multipleTitles: this.checkMultipleTitleTags(contentData),
        titleTagCount: contentData.titleTagCount || 1,

        // Heading structure with new flags
        headingStructure: {
          h1Count: contentData.headingStructure?.h1Count || 0,
          h2Count: contentData.headingStructure?.h2Count || 0,
          h3Count: contentData.headingStructure?.h3Count || 0,
          h4Count: contentData.headingStructure?.h4Count || 0,
          h5Count: contentData.headingStructure?.h5Count || 0,
          h6Count: contentData.headingStructure?.h6Count || 0,
          h1Text: contentData.headingStructure?.h1Text || "",
          h2Texts: contentData.headingStructure?.h2Texts || [],
        },
        oneH1Only: (contentData.headingStructure?.h1Count || 0) === 1,
        headingsProperOrder: this.checkHeadingOrder(
          contentData.headingStructure
        ),

        // URL data with new flags
        urlTooLong: urlLength > 100,
        urlLength,

        updatedAt: new Date(),
      };

      // Check if content already exists for this core
      const existingContent = await WebpageContent.findOne({ webpageCoreId });

      if (existingContent) {
        // Update existing content
        const updatedContent = await WebpageContent.findByIdAndUpdate(
          existingContent._id,
          contentDataToSave,
          { new: true, runValidators: true }
        );

        this.stats.contentUpdated++;
        this.stats.documentsUpdated++;
        logger.debug(`Updated WebpageContent for core: ${webpageCoreId}`);
        return updatedContent;
      } else {
        // Create new content
        contentDataToSave.createdAt = new Date();
        const newContent = new WebpageContent(contentDataToSave);
        const savedContent = await newContent.save();

        this.stats.contentCreated++;
        this.stats.documentsCreated++;
        logger.debug(`Created WebpageContent for core: ${webpageCoreId}`);
        return savedContent;
      }
    } catch (error) {
      logger.error(
        `Error saving WebpageContent for core ${webpageCoreId}`,
        error
      );
      throw error;
    }
  }

  // CHANGED: Check for multiple title tags instead of readability
  checkMultipleTitleTags(contentData) {
    const titleTagCount =
      contentData.titleTagCount || contentData.technicalSeo?.titleTagCount || 1;
    return titleTagCount > 1;
  }

  // Check if headings follow proper order (H1 -> H2 -> H3)
  checkHeadingOrder(headingStructure) {
    if (!headingStructure) return false;

    const h1Count = headingStructure.h1Count || 0;
    const h2Count = headingStructure.h2Count || 0;
    const h3Count = headingStructure.h3Count || 0;

    // Must have H1, and if H3 exists, must have H2
    if (h1Count === 0) return false;
    if (h3Count > 0 && h2Count === 0) return false;

    return true;
  }

  // Save/update WebpageTechnical
  async upsertWebpageTechnical(technicalData, webpageCoreId, isExistingCore) {
    try {
      const technicalDataToSave = {
        webpageCoreId,

        // Technical SEO
        technicalSeo: {
          canonicalTagExists:
            technicalData.technicalSeo?.canonicalTagExists || false,
          canonicalUrl: technicalData.technicalSeo?.canonicalUrl || "",
          robotsDirectives: technicalData.technicalSeo?.robotsDirectives || "",
          hreflangTags: technicalData.technicalSeo?.hreflangTags || [],
          structuredData: technicalData.technicalSeo?.structuredData || false,
          hasViewport: technicalData.technicalSeo?.hasViewport || false,
          hasCharset: technicalData.technicalSeo?.hasCharset || false,
        },

        // Links analysis with new fields
        links: {
          totalCount: technicalData.links?.totalCount || 0,
          internalCount: technicalData.links?.internalCount || 0,
          externalCount: technicalData.links?.externalCount || 0,
          internalBrokenLinksCount: technicalData.internalBrokenLinks
            ? technicalData.internalBrokenLinks.length
            : 0, // NEW
          externalBrokenLinksCount: technicalData.externalBrokenLinks
            ? technicalData.externalBrokenLinks.length
            : 0, // NEW
          redirectLinksCount: technicalData.redirectLinks
            ? technicalData.redirectLinks.length
            : 0, // NEW
          httpLinksCount: technicalData.links?.httpLinksCount || 0,
          httpsLinksCount: technicalData.links?.httpsLinksCount || 0,
        },

        // Broken links
        internalBrokenLinks: technicalData.internalBrokenLinks || [], // NEW
        externalBrokenLinks: technicalData.externalBrokenLinks || [], // NEW
        redirectLinks: technicalData.redirectLinks || [],
        // Performance metrics - ENHANCED for mobile
        performance: {
          mobileResponsive:
            technicalData.performance?.mobileResponsive || false,
          hasViewportMeta:
            technicalData.performance?.hasViewportMeta ||
            technicalData.technicalSeo?.hasViewport ||
            false,
          hasMediaQueries: technicalData.performance?.hasMediaQueries || false,
          isResponsiveDesign:
            technicalData.performance?.isResponsiveDesign ||
            technicalData.performance?.mobileResponsive ||
            false,
          pageSize: technicalData.performance?.pageSize || 0,
          webVitals: {
            LCP: technicalData.performance?.webVitals?.LCP || 0,
            FID: technicalData.performance?.webVitals?.FID || 0,
            CLS: technicalData.performance?.webVitals?.CLS || 0,
          },
        },

        updatedAt: new Date(),
      };

      // Check if technical data already exists for this core
      const existingTechnical = await WebpageTechnical.findOne({
        webpageCoreId,
      });

      if (existingTechnical) {
        // Update existing technical data
        const updatedTechnical = await WebpageTechnical.findByIdAndUpdate(
          existingTechnical._id,
          technicalDataToSave,
          { new: true, runValidators: true }
        );

        this.stats.technicalUpdated++;
        this.stats.documentsUpdated++;
        logger.debug(`Updated WebpageTechnical for core: ${webpageCoreId}`);
        return updatedTechnical;
      } else {
        // Create new technical data
        technicalDataToSave.createdAt = new Date();
        const newTechnical = new WebpageTechnical(technicalDataToSave);
        const savedTechnical = await newTechnical.save();

        this.stats.technicalCreated++;
        this.stats.documentsCreated++;
        logger.debug(`Created WebpageTechnical for core: ${webpageCoreId}`);
        return savedTechnical;
      }
    } catch (error) {
      logger.error(
        `Error saving WebpageTechnical for core ${webpageCoreId}`,
        error
      );
      throw error;
    }
  }

  // Save/update WebpageAnalysis
  async upsertWebpageAnalysis(analysisData, webpageCoreId, isExistingCore) {
    try {
      const imagesData = analysisData.images || {};
      const altTextPercentage =
        imagesData.totalCount > 0
          ? (imagesData.withAlt / imagesData.totalCount) * 100
          : 0;

      const analysisDataToSave = {
        webpageCoreId,

        // Image analysis with new fields
        images: {
          totalCount: imagesData.totalCount || 0,
          withAlt: imagesData.withAlt || 0,
          withTitle: imagesData.withTitle || 0,
          altMissingCount:
            (imagesData.totalCount || 0) - (imagesData.withAlt || 0),
          altTextPercentage: Math.round(altTextPercentage),
        },

        // Duplicate analysis
        duplicates: {
          titleDuplicates: analysisData.duplicates?.titleDuplicates || [],
          descriptionDuplicates:
            analysisData.duplicates?.descriptionDuplicates || [],
          contentDuplicates: analysisData.duplicates?.contentDuplicates || [],
        },

        // Content quality analysis with new fields - CHANGED
        contentQuality: {
          spellingErrors:
            analysisData.grammarSpelling?.spellingErrors ||
            analysisData.contentQuality?.spellingErrors ||
            [],
          spellingErrorsCount: (
            analysisData.grammarSpelling?.spellingErrors ||
            analysisData.contentQuality?.spellingErrors ||
            []
          ).length,
          grammarErrors:
            analysisData.grammarSpelling?.grammarErrors ||
            analysisData.contentQuality?.grammarErrors ||
            [],
          grammarErrorsCount: (
            analysisData.grammarSpelling?.grammarErrors ||
            analysisData.contentQuality?.grammarErrors ||
            []
          ).length,
          totalLanguageErrors: this.calculateTotalLanguageErrors(analysisData),
        },

        // Analysis completion flags
        slowAnalysisCompleted: analysisData.slowAnalysisCompleted || false,
        analysisVersion: "3.0",

        updatedAt: new Date(),
      };

      // Check if analysis data already exists for this core
      const existingAnalysis = await WebpageAnalysis.findOne({ webpageCoreId });

      if (existingAnalysis) {
        // Update existing analysis data
        const updatedAnalysis = await WebpageAnalysis.findByIdAndUpdate(
          existingAnalysis._id,
          analysisDataToSave,
          { new: true, runValidators: true }
        );

        this.stats.analysisUpdated++;
        this.stats.documentsUpdated++;
        logger.debug(`Updated WebpageAnalysis for core: ${webpageCoreId}`);
        return updatedAnalysis;
      } else {
        // Create new analysis data
        analysisDataToSave.createdAt = new Date();
        const newAnalysis = new WebpageAnalysis(analysisDataToSave);
        const savedAnalysis = await newAnalysis.save();

        this.stats.analysisCreated++;
        this.stats.documentsCreated++;
        logger.debug(`Created WebpageAnalysis for core: ${webpageCoreId}`);
        return savedAnalysis;
      }
    } catch (error) {
      logger.error(
        `Error saving WebpageAnalysis for core ${webpageCoreId}`,
        error
      );
      throw error;
    }
  }

  // CHANGED: Calculate total language errors (spelling + grammar)
  calculateTotalLanguageErrors(analysisData) {
    const spellingCount = (
      analysisData.grammarSpelling?.spellingErrors ||
      analysisData.contentQuality?.spellingErrors ||
      []
    ).length;
    const grammarCount = (
      analysisData.grammarSpelling?.grammarErrors ||
      analysisData.contentQuality?.grammarErrors ||
      []
    ).length;
    return spellingCount + grammarCount;
  }

  // Save/update WebpageScores (updated for new 20-point system)
  async upsertWebpageScores(scoresData, webpageCoreId, isExistingCore) {
    try {
      const scoresDataToSave = {
        webpageCoreId,

        // Overall scores
        seoScore: scoresData.seoScore || 0,
        seoGrade: scoresData.seoGrade || "F",

        // Individual scores for 20-point system
        scores: scoresData.scores || {
          titleNotMissing: 0,
          titleRightLength: 0,
          titleNotDuplicated: 0,
          metaDescNotMissing: 0,
          metaDescRightLength: 0,
          metaDescNotDuplicated: 0,
          contentNotTooShort: 0,
          noMultipleTitles: 0, // CHANGED
          oneH1Only: 0,
          headingsProperOrder: 0,
          urlNotTooLong: 0,
          canonicalTagExists: 0,
          internalLinksGood: 0,
          externalLinksBalanced: 0,
          noBrokenLinks: 0,
          noHttpLinks: 0,
          mobileResponsive: 0,
          imagesHaveAltText: 0,
          noGrammarSpellingErrors: 0, // CHANGED
          contentNotDuplicated: 0,
        },

        // Score calculation metadata
        lastCalculated: new Date(),
        calculationVersion: "3.0",

        updatedAt: new Date(),
      };

      // Check if scores data already exists for this core
      const existingScores = await WebpageScores.findOne({ webpageCoreId });

      if (existingScores) {
        // Update existing scores data
        const updatedScores = await WebpageScores.findByIdAndUpdate(
          existingScores._id,
          scoresDataToSave,
          { new: true, runValidators: true }
        );

        this.stats.scoresUpdated++;
        this.stats.documentsUpdated++;
        logger.debug(`Updated WebpageScores for core: ${webpageCoreId}`);
        return updatedScores;
      } else {
        // Create new scores data
        scoresDataToSave.createdAt = new Date();
        const newScores = new WebpageScores(scoresDataToSave);
        const savedScores = await newScores.save();

        this.stats.scoresCreated++;
        this.stats.documentsCreated++;
        logger.debug(`Created WebpageScores for core: ${webpageCoreId}`);
        return savedScores;
      }
    } catch (error) {
      logger.error(
        `Error saving WebpageScores for core ${webpageCoreId}`,
        error
      );
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async upsertWebpage(webpageData, userId, websiteUrl, pageUrl) {
    // Transform old format to new format if needed
    const transformedData = {
      core: {
        userActivityId: webpageData.userActivityId,
        statusCode: webpageData.statusCode,
        processingMethod: webpageData.processingMethod,
        responseTime: webpageData.responseTime,
        hasErrors: webpageData.hasErrors,
        isProcessed: webpageData.isProcessed,
        slowAnalysisCompleted: webpageData.slowAnalysisCompleted,
      },
      content:
        webpageData.title || webpageData.metaDescription || webpageData.content
          ? webpageData
          : null,
      technicalSeo: webpageData.technicalSeo,
      links: webpageData.links,
      performance: webpageData.performance,
      brokenLinks: webpageData.brokenLinks,
      duplicates: webpageData.duplicates,
      images: webpageData.images,
      grammarSpelling: webpageData.grammarSpelling,
    };

    return await this.upsertCompleteWebpage(
      transformedData,
      userId,
      websiteUrl,
      pageUrl
    );
  }

  // Rest of the methods remain the same...
  async getCompleteWebpage(pageUrl, userActivityId = null) {
    try {
      const query = { pageUrl };
      if (userActivityId) {
        query.userActivityId = userActivityId;
      }

      const webpageCore = await WebpageCore.findOne(query)
        .populate("contentId")
        .populate("scoresId")
        .populate("technicalId")
        .populate("analysisId")
        .lean();

      if (!webpageCore) {
        return null;
      }

      return {
        core: webpageCore,
        content: webpageCore.contentId,
        scores: webpageCore.scoresId,
        technical: webpageCore.technicalId,
        analysis: webpageCore.analysisId,
      };
    } catch (error) {
      logger.error(`Error getting complete webpage ${pageUrl}`, error);
      return null;
    }
  }

  async getWebpagesForAnalysis(userActivityId) {
    try {
      return await WebpageCore.find({
        userActivityId,
        slowAnalysisCompleted: { $ne: true },
      })
        .populate("contentId")
        .populate("scoresId")
        .populate("technicalId")
        .populate("analysisId")
        .lean();
    } catch (error) {
      logger.error("Error getting webpages for analysis", error);
      return [];
    }
  }

  // Update duplicates and recalculate scores
  async updateDuplicates(webpageCoreId, duplicates) {
    try {
      const analysis = await WebpageAnalysis.findOne({ webpageCoreId });

      if (analysis) {
        await WebpageAnalysis.findByIdAndUpdate(analysis._id, {
          "duplicates.titleDuplicates": duplicates.titleDuplicates || [],
          "duplicates.descriptionDuplicates":
            duplicates.descriptionDuplicates || [],
          "duplicates.contentDuplicates": duplicates.contentDuplicates || [],
          updatedAt: new Date(),
        });

        // Update content flags
        const content = await WebpageContent.findOne({ webpageCoreId });
        if (content) {
          await WebpageContent.findByIdAndUpdate(content._id, {
            titleDuplicated: duplicates.titleDuplicates?.length > 0,
            metaDescriptionDuplicated:
              duplicates.descriptionDuplicates?.length > 0,
            updatedAt: new Date(),
          });
        }

        // Recalculate scores
        await this.recalculateScores(webpageCoreId);
      }
    } catch (error) {
      logger.error(
        `Error updating duplicates for webpage core ${webpageCoreId}`,
        error
      );
    }
  }

  // Update broken links and recalculate scores
  async updateLinks(webpageCoreId, linkResults) {
    try {
      const technical = await WebpageTechnical.findOne({ webpageCoreId });

      if (technical) {
        await WebpageTechnical.findByIdAndUpdate(technical._id, {
          internalBrokenLinks: linkResults.internalBrokenLinks,
          externalBrokenLinks: linkResults.externalBrokenLinks,
          redirectLinks: linkResults.redirectLinks,
          "links.internalBrokenLinksCount":
            linkResults.internalBrokenLinks.length,
          "links.externalBrokenLinksCount":
            linkResults.externalBrokenLinks.length,
          "links.redirectLinksCount": linkResults.redirectLinks.length,
          updatedAt: new Date(),
        });

        await this.recalculateScores(webpageCoreId);
      }
    } catch (error) {
      logger.error(
        `Error updating links for webpage core ${webpageCoreId}`,
        error
      );
    }
  }

  // Recalculate SEO scores for a webpage
  async recalculateScores(webpageCoreId) {
    try {
      // Get all related data
      const content = await WebpageContent.findOne({ webpageCoreId });
      const technical = await WebpageTechnical.findOne({ webpageCoreId });
      const analysis = await WebpageAnalysis.findOne({ webpageCoreId });

      const results = { content, technical, analysis };

      // Recalculate and save scores
      const updatedScores = await this.calculateAndSaveScores(
        webpageCoreId,
        results,
        true
      );

      // Update core with new scores
      if (updatedScores) {
        await WebpageCore.findByIdAndUpdate(webpageCoreId, {
          seoScore: updatedScores.seoScore,
          seoGrade: updatedScores.seoGrade,
          updatedAt: new Date(),
        });
      }

      return updatedScores;
    } catch (error) {
      logger.error(
        `Error recalculating scores for webpage core ${webpageCoreId}`,
        error
      );
    }
  }

  getStats() {
    return {
      ...this.stats,
      totalProcessed: this.stats.documentsUpdated + this.stats.documentsCreated,
      updateRate:
        this.stats.documentsUpdated > 0
          ? (
              (this.stats.documentsUpdated /
                (this.stats.documentsUpdated + this.stats.documentsCreated)) *
              100
            ).toFixed(1) + "%"
          : "0%",
      breakdown: {
        core: {
          created: this.stats.coreCreated,
          updated: this.stats.coreUpdated,
        },
        content: {
          created: this.stats.contentCreated,
          updated: this.stats.contentUpdated,
        },
        technical: {
          created: this.stats.technicalCreated,
          updated: this.stats.technicalUpdated,
        },
        analysis: {
          created: this.stats.analysisCreated,
          updated: this.stats.analysisUpdated,
        },
        scores: {
          created: this.stats.scoresCreated,
          updated: this.stats.scoresUpdated,
        },
      },
    };
  }

  resetStats() {
    this.stats = {
      documentsUpdated: 0,
      documentsCreated: 0,
      errors: 0,
      coreUpdated: 0,
      coreCreated: 0,
      contentUpdated: 0,
      contentCreated: 0,
      technicalUpdated: 0,
      technicalCreated: 0,
      analysisUpdated: 0,
      analysisCreated: 0,
      scoresUpdated: 0,
      scoresCreated: 0,
    };
  }
}

module.exports = WebpageService;
