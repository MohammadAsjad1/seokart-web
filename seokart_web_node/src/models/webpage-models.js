const mongoose = require("mongoose");

// Core webpage information
const WebpageCoreSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userActivityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    websiteUrl: { type: String, required: true },
    pageUrl: { type: String, required: true },
    statusCode: { type: Number, default: 200 },
    lastCrawled: { type: Date, required: true },
    scrapedAt: { type: Date, required: true },

    // SEO scores
    seoScore: { type: Number, default: 0, min: 0, max: 100 },
    seoGrade: { type: String, enum: ["A", "B", "C", "D", "F"], default: "F" },

    // Processing metadata
    processingMethod: { type: String, default: "nodejs_scraper" },
    responseTime: { type: Number, default: 0 },
    hasErrors: { type: Boolean, default: false },
    errorMessage: { type: String, default: "" },
    isProcessed: { type: Boolean, default: false },
    processedAt: { type: Date },
    slowAnalysisCompleted: { type: Boolean, default: false },

    // References to other documents
    contentId: { type: mongoose.Schema.Types.ObjectId, ref: "WebpageContent" },
    scoresId: { type: mongoose.Schema.Types.ObjectId, ref: "WebpageScores" },
    technicalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageTechnical",
    },
    analysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageAnalysis",
    },
  },
  {
    timestamps: true,
    collection: "webpage_cores",
  }
);

// Content-related data
const WebpageContentSchema = new mongoose.Schema(
  {
    webpageCoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageCore",
      required: true,
    },

    // Point 1: Title should not be missing (5%)
    title: { type: String, default: "" },
    titleLength: { type: Number, default: 0 },
    titleMissing: { type: Boolean, default: true },

    // Point 2: Title should be the right length (5%)
    titleRightLength: { type: Boolean, default: false },

    // Point 3: Title should not be duplicated (5%)
    titleDuplicated: { type: Boolean, default: false },

    // Point 4: Meta description should not be missing (5%)
    metaDescription: { type: String, default: "" },
    metaDescriptionLength: { type: Number, default: 0 },
    metaDescriptionMissing: { type: Boolean, default: true },

    // Point 5: Meta description should be the right length (5%)
    metaDescriptionRightLength: { type: Boolean, default: false },

    // Point 6: Meta description should not be duplicated (5%)
    metaDescriptionDuplicated: { type: Boolean, default: false },

    // Point 7: Content should not be too short (5%)
    content: { type: String, default: "" },
    wordCount: { type: Number, default: 0 },
    contentTooShort: { type: Boolean, default: true },

    // Point 8: Page should not have multiple title tags (5%)
    multipleTitles: { type: Boolean, default: false },
    titleTagCount: { type: Number, default: 0 },

    // Point 9: Headings should have one H1 only (5%)
    headingStructure: {
      h1Count: { type: Number, default: 0 },
      h2Count: { type: Number, default: 0 },
      h3Count: { type: Number, default: 0 },
      h4Count: { type: Number, default: 0 },
      h5Count: { type: Number, default: 0 },
      h6Count: { type: Number, default: 0 },
      h1Text: { type: String, default: "" },
      h2Texts: [{ type: String }],
    },
    oneH1Only: { type: Boolean, default: false },

    // Point 10: Headings should use H2/H3 in proper order (5%)
    headingsProperOrder: { type: Boolean, default: false },

    // Point 11: URL should not be too long (5%)
    urlTooLong: { type: Boolean, default: false },
    urlLength: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: "webpage_contents",
  }
);

// SEO scores - exactly 20 points, each 5%
const WebpageScoresSchema = new mongoose.Schema(
  {
    webpageCoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageCore",
      required: true,
    },

    // Overall score calculation (sum of 20 points × 5% each = 100%)
    seoScore: { type: Number, default: 0, min: 0, max: 100 },
    seoGrade: { type: String, enum: ["A", "B", "C", "D", "F"], default: "F" },

    // Individual scores for each point (5% each)
    scores: {
      // Point 1: Title should not be missing (5%)
      titleNotMissing: { type: Number, default: 0, min: 0, max: 5 },

      // Point 2: Title should be the right length (5%)
      titleRightLength: { type: Number, default: 0, min: 0, max: 5 },

      // Point 3: Title should not be duplicated (5%)
      titleNotDuplicated: { type: Number, default: 0, min: 0, max: 5 },

      // Point 4: Meta description should not be missing (5%)
      metaDescNotMissing: { type: Number, default: 0, min: 0, max: 5 },

      // Point 5: Meta description should be the right length (5%)
      metaDescRightLength: { type: Number, default: 0, min: 0, max: 5 },

      // Point 6: Meta description should not be duplicated (5%)
      metaDescNotDuplicated: { type: Number, default: 0, min: 0, max: 5 },

      // Point 7: Content should not be too short (5%)
      contentNotTooShort: { type: Number, default: 0, min: 0, max: 5 },

      // Point 8: Page should not have multiple title tags (5%)
      noMultipleTitles: { type: Number, default: 0, min: 0, max: 5 },

      // Point 9: Headings should have one H1 only (5%)
      oneH1Only: { type: Number, default: 0, min: 0, max: 5 },

      // Point 10: Headings should use H2/H3 in proper order (5%)
      headingsProperOrder: { type: Number, default: 0, min: 0, max: 5 },

      // Point 11: URL should not be too long (5%)
      urlNotTooLong: { type: Number, default: 0, min: 0, max: 5 },

      // Point 12: Canonical tag should exist (5%)
      canonicalTagExists: { type: Number, default: 0, min: 0, max: 5 },

      // Point 13: No redirect links (5%)
      noRedirectLinks: { type: Number, default: 0, min: 0, max: 5 },

      // Point 14: No HTTP links (should use HTTPS) (5%)
      noHttpLinks: { type: Number, default: 0, min: 0, max: 5 },

      // Point 15: No internal broken links (5%)
      noInternalBrokenLinks: { type: Number, default: 0, min: 0, max: 5 },

      // Point 16: No external broken links (5%)
      noExternalBrokenLinks: { type: Number, default: 0, min: 0, max: 5 },

      // Point 17: Website should be fully mobile responsive (5%)
      mobileResponsive: { type: Number, default: 0, min: 0, max: 5 },

      // Point 18: Images should have alt text (5%)
      imagesHaveAltText: { type: Number, default: 0, min: 0, max: 5 },

      // Point 19: Content should not have spelling and grammar errors (5%)
      noGrammarSpellingErrors: { type: Number, default: 0, min: 0, max: 5 },

      // Point 20: Content should not be duplicated (5%)
      contentNotDuplicated: { type: Number, default: 0, min: 0, max: 5 },
    },

    // Score calculation metadata
    lastCalculated: { type: Date, default: Date.now },
    calculationVersion: { type: String, default: "4.0" }, // Updated version
  },
  {
    timestamps: true,
    collection: "webpage_scores",
  }
);

// Technical SEO and performance data
const WebpageTechnicalSchema = new mongoose.Schema(
  {
    webpageCoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageCore",
      required: true,
    },

    // Point 12: Canonical tag should exist (5%)
    technicalSeo: {
      canonicalTagExists: { type: Boolean, default: false },
      canonicalUrl: { type: String, default: "" },
      robotsDirectives: { type: String, default: "" },
      hreflangTags: [{ type: String }],
      structuredData: { type: Boolean, default: false },
      hasViewport: { type: Boolean, default: false },
      hasCharset: { type: Boolean, default: false },
    },

    // Points 13, 14, 15, 16: Links analysis
    links: {
      totalCount: { type: Number, default: 0 },
      internalCount: { type: Number, default: 0 },
      externalCount: { type: Number, default: 0 },
      internalBrokenLinksCount: { type: Number, default: 0 },
      externalBrokenLinksCount: { type: Number, default: 0 },
      redirectLinksCount: { type: Number, default: 0 },
      httpLinksCount: { type: Number, default: 0 },
      httpsLinksCount: { type: Number, default: 0 },
      // Stored at scrape time for link validation phase (no re-fetch). Capped by config.
      allLinks: [
        {
          url: { type: String },
          text: { type: String },
          type: { type: String, enum: ["internal", "external"] },
          rel: { type: String },
        },
      ],
    },

    // Point 15: Internal broken links details
    internalBrokenLinks: [
      {
        url: { type: String },
        text: { type: String },
        error: { type: String },
        statusCode: { type: Number },
      },
    ],

    // Point 16: External broken links details
    externalBrokenLinks: [
      {
        url: { type: String },
        text: { type: String },
        error: { type: String },
        statusCode: { type: Number },
      },
    ],

    // Point 13: Redirect links tracking
    redirectLinks: [
      {
        url: { type: String },
        text: { type: String },
        redirectTo: { type: String },
        statusCode: { type: Number },
        type: { type: String, enum: ['internal', 'external'] },
      },
    ],

    // Point 14: HTTP links tracking (insecure links)
    httpLinks: [
      {
        url: { type: String },
        text: { type: String },
        type: { type: String, enum: ['internal', 'external'] },
      },
    ],

    // Point 17: Mobile responsiveness
    performance: {
      mobileResponsive: { type: Boolean, default: false },
      hasViewportMeta: { type: Boolean, default: false },
      hasMediaQueries: { type: Boolean, default: false },
      isResponsiveDesign: { type: Boolean, default: false },
      pageSize: { type: Number, default: 0 },
      webVitals: {
        LCP: { type: Number, default: 0 },
        FID: { type: Number, default: 0 },
        CLS: { type: Number, default: 0 },
      },
    },
  },
  {
    timestamps: true,
    collection: "webpage_technical",
  }
);

const WebpageAnalysisSchema = new mongoose.Schema(
  {
    webpageCoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebpageCore",
      required: true,
    },

    // Point 18: Image analysis
    images: {
      totalCount: { type: Number, default: 0 },
      withAlt: { type: Number, default: 0 },
      withTitle: { type: Number, default: 0 },
      altMissingCount: { type: Number, default: 0 },
      altTextPercentage: { type: Number, default: 0 },
    },

    // Points 3, 6, 20: Duplicate analysis
    duplicates: {
      titleDuplicates: [
        {
          pageUrl: { type: String },
          title: { type: String },
          duplicateType: { type: String, enum: ["exact_match", "similar"] },
          similarity: { type: Number, min: 0, max: 1 },
        },
      ],
      descriptionDuplicates: [
        {
          pageUrl: { type: String },
          description: { type: String },
          duplicateType: { type: String, enum: ["exact_match", "similar"] },
        },
      ],
      contentDuplicates: [
        {
          pageUrl: { type: String },
          similarity: { type: Number, min: 0, max: 1 },
          duplicateType: {
            type: String,
            enum: ["exact_match", "high_similarity"],
          },
          wordCount: { type: Number },
        },
      ],
    },

    // Point 19: Content quality
    contentQuality: {
      spellingErrors: [{ type: String }],
      spellingErrorsCount: { type: Number, default: 0 },
      grammarErrors: { type: [String], default: [] },
      grammarErrorsCount: { type: Number, default: 0 },
      totalLanguageErrors: { type: Number, default: 0 },
    },

    // Analysis completion flags
    slowAnalysisCompleted: { type: Boolean, default: false },
    analysisVersion: { type: String, default: "4.0" },
  },
  {
    timestamps: true,
    collection: "webpage_analysis",
  }
);

// Sitemap URLs storage
const SitemapSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    urlType: { type: Number, required: true }, // 0 = sitemap, 1 = webpage
    userActivityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: Number, default: 1 }, // 1 = pending, 2 = processed, 3 = failed
    parentSitemaps: [{ type: mongoose.Schema.Types.ObjectId }],
    processedAt: { type: Date },
    errorMessage: { type: String },
  },
  {
    timestamps: true,
    collection: "sitemaps",
  }
);

// Create indexes for better performance
WebpageCoreSchema.index({ userId: 1, websiteUrl: 1 });
WebpageCoreSchema.index({ userActivityId: 1 });
WebpageCoreSchema.index({ userId: 1, pageUrl: 1 });
WebpageCoreSchema.index({ seoScore: -1 });
WebpageCoreSchema.index({ websiteUrl: 1 });

WebpageContentSchema.index({ webpageCoreId: 1 });
WebpageScoresSchema.index({ webpageCoreId: 1 });
WebpageTechnicalSchema.index({ webpageCoreId: 1 });
WebpageAnalysisSchema.index({ webpageCoreId: 1 });

SitemapSchema.index({ userActivityId: 1, urlType: 1 });
SitemapSchema.index({ url: 1, urlType: 1 });

// SEO Score calculation function - ALL 20 POINTS INCLUDED
const calculateSEOScore = (scores) => {
  const {
    titleNotMissing = 0,
    titleRightLength = 0,
    titleNotDuplicated = 0,
    metaDescNotMissing = 0,
    metaDescRightLength = 0,
    metaDescNotDuplicated = 0,
    contentNotTooShort = 0,
    noMultipleTitles = 0,
    oneH1Only = 0,
    headingsProperOrder = 0,
    urlNotTooLong = 0,
    canonicalTagExists = 0,
    noRedirectLinks = 0,
    noHttpLinks = 0,
    noInternalBrokenLinks = 0,
    noExternalBrokenLinks = 0,
    mobileResponsive = 0,
    imagesHaveAltText = 0,
    noGrammarSpellingErrors = 0,
    contentNotDuplicated = 0,
  } = scores;

  // Each point contributes exactly 5% to total score (20 points × 5% = 100%)
  const totalScore =
    titleNotMissing + // Point 1: 5%
    titleRightLength + // Point 2: 5%
    titleNotDuplicated + // Point 3: 5%
    metaDescNotMissing + // Point 4: 5%
    metaDescRightLength + // Point 5: 5%
    metaDescNotDuplicated + // Point 6: 5%
    contentNotTooShort + // Point 7: 5%
    noMultipleTitles + // Point 8: 5%
    oneH1Only + // Point 9: 5%
    headingsProperOrder + // Point 10: 5%
    urlNotTooLong + // Point 11: 5%
    canonicalTagExists + // Point 12: 5%
    noRedirectLinks + // Point 13: 5%
    noHttpLinks + // Point 14: 5%
    noInternalBrokenLinks + // Point 15: 5%
    noExternalBrokenLinks + // Point 16: 5%
    mobileResponsive + // Point 17: 5%
    imagesHaveAltText + // Point 18: 5%
    noGrammarSpellingErrors + // Point 19: 5%
    contentNotDuplicated; // Point 20: 5%
  // Total = 100%

  // Calculate grade based on score
  let grade = "F";
  if (totalScore >= 90) grade = "A";
  else if (totalScore >= 80) grade = "B";
  else if (totalScore >= 70) grade = "C";
  else if (totalScore >= 60) grade = "D";

  return { totalScore, grade };
};

// Export models
module.exports = {
  WebpageCore: mongoose.model("WebpageCore", WebpageCoreSchema),
  WebpageContent: mongoose.model("WebpageContent", WebpageContentSchema),
  WebpageScores: mongoose.model("WebpageScores", WebpageScoresSchema),
  WebpageTechnical: mongoose.model("WebpageTechnical", WebpageTechnicalSchema),
  WebpageAnalysis: mongoose.model("WebpageAnalysis", WebpageAnalysisSchema),
  Sitemap: mongoose.model("Sitemap", SitemapSchema),
  calculateSEOScore,
};