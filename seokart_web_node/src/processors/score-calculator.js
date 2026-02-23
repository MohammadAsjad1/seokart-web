const config = require("../config/scraper");
const logger = require("../config/logger");

class ScoreCalculator {
  constructor() {
    // New 20-point system - each point is worth exactly 5%
    this.pointWeights = {
      titleNotMissing: 5, // Point 1
      titleRightLength: 5, // Point 2
      titleNotDuplicated: 5, // Point 3
      metaDescNotMissing: 5, // Point 4
      metaDescRightLength: 5, // Point 5
      metaDescNotDuplicated: 5, // Point 6
      contentNotTooShort: 5, // Point 7
      noMultipleTitles: 5, // Point 8
      oneH1Only: 5, // Point 9
      headingsProperOrder: 5, // Point 10
      urlNotTooLong: 5, // Point 11
      canonicalTagExists: 5, // Point 12
      noRedirectLinks: 5, // Point 13 - CHANGED from internalLinksGood
      reservedPoint: 5, // Point 14 - CHANGED from externalLinksBalanced
      noInternalBrokenLinks: 5, // Point 15
      noExternalBrokenLinks: 5, // Point 16
      mobileResponsive: 5, // Point 17
      imagesHaveAltText: 5, // Point 18
      noGrammarSpellingErrors: 5, // Point 19
      contentNotDuplicated: 5, // Point 20
    };
  }

  // NEW 20-Point System Score Calculation
  calculateNewSystemScores(webpageData) {
    const scores = {
      // Point 1: Title should not be missing (5%)
      titleNotMissing: this.checkTitleNotMissing(webpageData),

      // Point 2: Title should be the right length (5%)
      titleRightLength: this.checkTitleRightLength(webpageData),

      // Point 3: Title should not be duplicated (5%)
      titleNotDuplicated: this.checkTitleNotDuplicated(webpageData),

      // Point 4: Meta description should not be missing (5%)
      metaDescNotMissing: this.checkMetaDescNotMissing(webpageData),

      // Point 5: Meta description should be the right length (5%)
      metaDescRightLength: this.checkMetaDescRightLength(webpageData),

      // Point 6: Meta description should not be duplicated (5%)
      metaDescNotDuplicated: this.checkMetaDescNotDuplicated(webpageData),

      // Point 7: Content should not be too short (5%)
      contentNotTooShort: this.checkContentNotTooShort(webpageData),

      // Point 8: Page should not have multiple title tags (5%)
      noMultipleTitles: this.checkNoMultipleTitles(webpageData),

      // Point 9: Headings should have one H1 only (5%)
      oneH1Only: this.checkOneH1Only(webpageData),

      // Point 10: Headings should use H2/H3 in proper order (5%)
      headingsProperOrder: this.checkHeadingsProperOrder(webpageData),

      // Point 11: URL should not be too long (5%)
      urlNotTooLong: this.checkUrlNotTooLong(webpageData),

      // Point 12: Canonical tag should exist (5%)
      canonicalTagExists: this.checkCanonicalTagExists(webpageData),

      // Point 13: No redirect links (5%) - CHANGED
      noRedirectLinks: this.checkNoRedirectLinks(webpageData),

      noHttpLinks: this.checkNoHttpLinks(webpageData),

      // Point 15: No internal broken links (5%)
      noInternalBrokenLinks: this.checkNoInternalBrokenLinks(webpageData),

      // Point 16: No external broken links (5%)
      noExternalBrokenLinks: this.checkNoExternalBrokenLinks(webpageData),

      // Point 17: Website should be fully mobile responsive (5%)
      mobileResponsive: this.checkMobileResponsive(webpageData),

      // Point 18: Images should have alt text (5%)
      imagesHaveAltText: this.checkImagesHaveAltText(webpageData),

      // Point 19: Content should not have grammar and spelling errors (5%)
      noGrammarSpellingErrors: this.checkNoGrammarSpellingErrors(webpageData),

      // Point 20: Content should not be duplicated (5%)
      contentNotDuplicated: this.checkContentNotDuplicated(webpageData),
    };

    // Calculate total score (sum of all points)
    const totalScore = Object.values(scores).reduce(
      (sum, score) => sum + score,
      0
    );

    // Calculate grade
    const grade = this.calculateGrade(totalScore);

    return {
      scores,
      totalScore,
      grade,
      breakdown: this.getScoreBreakdown(scores),
    };
  }

  // Individual Point Checkers
  checkTitleNotMissing(data) {
    const title = data.title || data.content?.title || "";
    return title.trim() ? 5 : 0;
  }

  checkTitleRightLength(data) {
    const titleLength =
      data.titleLength || (data.title || data.content?.title || "").length;
    return titleLength >= 30 && titleLength <= 60 ? 5 : 0;
  }

  checkTitleNotDuplicated(data) {
    const titleDuplicates =
      data.duplicates?.titleDuplicates ||
      data.analysis?.duplicates?.titleDuplicates ||
      [];
    return titleDuplicates.length === 0 ? 5 : 0;
  }

  checkMetaDescNotMissing(data) {
    const metaDesc =
      data.metaDescription || data.content?.metaDescription || "";
    return metaDesc.trim() ? 5 : 0;
  }

  checkMetaDescRightLength(data) {
    const metaDescLength =
      data.metaDescriptionLength ||
      (data.metaDescription || data.content?.metaDescription || "").length;
    return metaDescLength >= 120 && metaDescLength <= 160 ? 5 : 0;
  }

  checkMetaDescNotDuplicated(data) {
    const descDuplicates =
      data.duplicates?.descriptionDuplicates ||
      data.analysis?.duplicates?.descriptionDuplicates ||
      [];
    return descDuplicates.length === 0 ? 5 : 0;
  }

  checkContentNotTooShort(data) {
    const wordCount = data.wordCount || data.content?.wordCount || 0;
    return wordCount >= 300 ? 5 : 0;
  }

  checkNoMultipleTitles(data) {
    const titleTagCount =
      data.titleTagCount ||
      data.content?.titleTagCount ||
      data.technicalSeo?.titleTagCount ||
      1;
    return titleTagCount === 1 ? 5 : 0;
  }

  checkOneH1Only(data) {
    const h1Count =
      data.headingStructure?.h1Count ||
      data.content?.headingStructure?.h1Count ||
      0;
    return h1Count === 1 ? 5 : 0;
  }

  checkHeadingsProperOrder(data) {
    const headingStructure =
      data.headingStructure || data.content?.headingStructure;
    if (!headingStructure) return 0;

    const h1Count = headingStructure.h1Count || 0;
    const h2Count = headingStructure.h2Count || 0;
    const h3Count = headingStructure.h3Count || 0;
    const h4Count = headingStructure.h4Count || 0;
    const h5Count = headingStructure.h5Count || 0;
    const h6Count = headingStructure.h6Count || 0;

    // Must have H1
    if (h1Count === 0) return 0;

    // Check proper hierarchy: h1 > h2 > h3 > h4 > h5 > h6
    // If a heading level exists, all previous levels should exist
    if (h6Count > 0 && h5Count === 0) return 0;
    if (h5Count > 0 && h4Count === 0) return 0;
    if (h4Count > 0 && h3Count === 0) return 0;
    if (h3Count > 0 && h2Count === 0) return 0;
    if (h2Count > 0 && h1Count === 0) return 0;

    return 5;
  }

  checkUrlNotTooLong(data) {
    const url = data.pageUrl || data.url || "";
    return url.length <= 100 ? 5 : 0;
  }

  checkCanonicalTagExists(data) {
    const canonicalExists =
      data.technicalSeo?.canonicalTagExists ||
      data.technical?.technicalSeo?.canonicalTagExists ||
      false;
    return canonicalExists ? 5 : 0;
  }

  checkNoRedirectLinks(data) {


    const redirectLinksCount =
      data.redirectLinks?.length ||
      data.links?.redirectLinksCount ||
      data.technical?.links?.redirectLinksCount ||
      data.technical?.redirectLinks?.length || data?.noRedirectLinks?.length ||
      0;
    return redirectLinksCount === 0 ? 5 : 0;
  }

  checkNoHttpLinks(data) {
    const httpLinksCount =
      data.httpLinks?.length ||
      data.links?.httpLinksCount ||
      data.technical?.links?.httpLinksCount ||
      data.technical?.httpLinks?.length ||
      0;

    return httpLinksCount === 0 ? 5 : 0;
  }

  // Point 15 - Check for no internal broken links
  checkNoInternalBrokenLinks(data) {
    const internalBrokenLinksCount =
      data.internalBrokenLinks?.length ||
      data.technical?.links?.internalBrokenLinksCount ||
      data.technical?.internalBrokenLinks?.length ||
      0;
    return internalBrokenLinksCount === 0 ? 5 : 0;
  }

  // Point 16 - Check for no external broken links
  checkNoExternalBrokenLinks(data) {
    const externalBrokenLinksCount =
      data.externalBrokenLinks?.length ||
      data.technical?.links?.externalBrokenLinksCount ||
      data.technical?.externalBrokenLinks?.length ||
      0;
    return externalBrokenLinksCount === 0 ? 5 : 0;
  }

  checkMobileResponsive(data) {
    const responsive = data.technicalSeo?.responsiveChecks;

    if (!responsive) return 0;

    const hasViewport = responsive?.hasViewport || false;
    const hasMediaQueries = responsive?.hasMediaQueries || false;
    const hasResponsiveUnits = responsive?.hasResponsiveUnits || false;

    const isResponsive = hasViewport && (hasMediaQueries || hasResponsiveUnits);

    return isResponsive ? 5 : 0;
  }

  checkImagesHaveAltText(data) {
    const images = data.images || data.analysis?.images;
    if (!images || images.totalCount === 0) return 5;

    const altTextPercentage =
      images.altTextPercentage ||
      (images.totalCount > 0 ? (images.withAlt / images.totalCount) * 100 : 0);
    return altTextPercentage >= 90 ? 5 : 0;
  }

  checkNoGrammarSpellingErrors(data) {
    const grammarSpelling =
      data.grammarSpelling || data.analysis?.contentQuality;
    if (!grammarSpelling) return 5;

    const spellingErrorsCount =
      grammarSpelling.spellingErrorsCount ||
      grammarSpelling.spellingErrors?.length ||
      0;
    const grammarErrorsCount =
      grammarSpelling.grammarErrorsCount ||
      grammarSpelling.grammarErrors?.length ||
      0;
    const totalErrors = spellingErrorsCount + grammarErrorsCount;

    return totalErrors === 0 ? 5 : 0;
  }

  checkContentNotDuplicated(data) {
    const contentDuplicates =
      data.duplicates?.contentDuplicates ||
      data.analysis?.duplicates?.contentDuplicates ||
      [];
    return contentDuplicates.length === 0 ? 5 : 0;
  }

  calculateGrade(totalScore) {
    if (totalScore >= 90) return "A";
    if (totalScore >= 80) return "B";
    if (totalScore >= 70) return "C";
    if (totalScore >= 60) return "D";
    return "F";
  }

  getScoreBreakdown(scores) {
    const breakdown = {
      titleIssues: {
        missing: scores.titleNotMissing === 0,
        wrongLength: scores.titleRightLength === 0,
        duplicated: scores.titleNotDuplicated === 0,
        multipleTitleTags: scores.noMultipleTitles === 0,
      },
      metaDescIssues: {
        missing: scores.metaDescNotMissing === 0,
        wrongLength: scores.metaDescRightLength === 0,
        duplicated: scores.metaDescNotDuplicated === 0,
      },
      contentIssues: {
        tooShort: scores.contentNotTooShort === 0,
        duplicated: scores.contentNotDuplicated === 0,
        grammarSpellingErrors: scores.noGrammarSpellingErrors === 0,
      },
      headingIssues: {
        noH1OrMultipleH1: scores.oneH1Only === 0,
        improperOrder: scores.headingsProperOrder === 0,
      },
      technicalIssues: {
        longUrl: scores.urlNotTooLong === 0,
        noCanonical: scores.canonicalTagExists === 0,
        notMobileResponsive: scores.mobileResponsive === 0,
      },
      linkIssues: {
        noHttpLinks: scores.noHttpLinks === 0,
        noRedirectLinks: scores.noRedirectLinks === 0,
        internalBrokenLinks: scores.noInternalBrokenLinks === 0,
        externalBrokenLinks: scores.noExternalBrokenLinks === 0,
      },
      imageIssues: {
        missingAltText: scores.imagesHaveAltText === 0,
      },
    };

    return breakdown;
  }

  calculateSEOScore(scores) {
    if (scores.titleNotMissing !== undefined) {
      const totalScore = Object.entries(this.pointWeights).reduce(
        (sum, [key, weight]) => {
          return sum + (scores[key] || 0);
        },
        0
      );

      const grade = this.calculateGrade(totalScore);
      return { totalScore, grade };
    }

    const result = this.calculateNewSystemScores(scores);
    return {
      totalScore: result.totalScore,
      grade: result.grade,
      scores: result.scores,
      breakdown: result.breakdown,
    };
  }

  // LEGACY METHODS
  calculateFastScores(scrapedData, grammarSpellIssues = {}) {
    const newResult = this.calculateNewSystemScores({
      ...scrapedData,
      grammarSpelling: grammarSpellIssues,
    });

    const legacyScores = {
      title:
        newResult.scores.titleNotMissing +
        newResult.scores.titleRightLength +
        newResult.scores.titleNotDuplicated,
      metaDescription:
        newResult.scores.metaDescNotMissing +
        newResult.scores.metaDescRightLength +
        newResult.scores.metaDescNotDuplicated,
      content:
        newResult.scores.contentNotTooShort +
        newResult.scores.noMultipleTitles +
        newResult.scores.contentNotDuplicated,
      headings:
        newResult.scores.oneH1Only + newResult.scores.headingsProperOrder,
      url: newResult.scores.urlNotTooLong,
      technical:
        newResult.scores.canonicalTagExists + newResult.scores.mobileResponsive,
      images: newResult.scores.imagesHaveAltText,
      links:
        newResult.scores.noRedirectLinks +
        newResult.scores.noHttpLinks +
        newResult.scores.noInternalBrokenLinks +
        newResult.scores.noExternalBrokenLinks,
      performance: newResult.scores.mobileResponsive,
      grammar: newResult.scores.noGrammarSpellingErrors,
      duplicates:
        newResult.scores.titleNotDuplicated +
        newResult.scores.metaDescNotDuplicated +
        newResult.scores.contentNotDuplicated,
    };

    Object.keys(legacyScores).forEach((key) => {
      legacyScores[key] = Math.min(100, (legacyScores[key] / 5) * 100);
    });

    legacyScores.overall = newResult.totalScore;
    return legacyScores;
  }

  calculateCompleteScores(webpageData) {
    const result = this.calculateNewSystemScores(webpageData);

    return {
      ...result.scores,
      overall: result.totalScore,
      grade: result.grade,
      breakdown: result.breakdown,
    };
  }
}

module.exports = ScoreCalculator;
