const isMissing = (val) => !val || String(val).trim().length === 0;
const outOfRange = (val, min, max) => (val ?? 0) < min || (val ?? 0) > max;
const scoreNot5 = (scores, key) => ((scores?.[key] ?? 0) !== 5 ? 1 : 0);

function getErrorCounts(doc) {
  const {
    pageUrl = "",
    contentId = {},
    technicalId = {},
    analysisId = {},
    scoresId = {},
  } = doc;
  const s = scoresId.scores;
  const links = technicalId.links ?? {};

  return {
    meta:
      (isMissing(contentId.title) ? 1 : 0) +
      (outOfRange(contentId.titleLength, 40, 60) ? 1 : 0) +
      (isMissing(contentId.metaDescription) ? 1 : 0) +
      (outOfRange(contentId.metaDescriptionLength, 120, 160) ? 1 : 0) +
      (analysisId.hasTitleDuplicates ? 1 : 0) +
      (analysisId.hasDescDuplicates ? 1 : 0),

    content:
      scoreNot5(s, "contentNotTooShort") +
      scoreNot5(s, "noGrammarSpellingErrors") +
      scoreNot5(s, "oneH1Only") +
      scoreNot5(s, "headingsProperOrder") +
      scoreNot5(s, "contentNotDuplicated"),

    image: (analysisId.images?.altMissingCount ?? 0) > 0 ? 1 : 0,

    url:
      (pageUrl.length > 100 ? 1 : 0) +
      ((links.internalBrokenLinksCount ?? 0) > 0 ? 1 : 0) +
      ((links.externalBrokenLinksCount ?? 0) > 0 ? 1 : 0) +
      ((links.redirectLinksCount ?? 0) > 0 ? 1 : 0),

    technical:
      (technicalId.technicalSeo?.canonicalTagExists !== true ? 1 : 0) +
      (technicalId.performance?.mobileResponsive !== true ? 1 : 0),
  };
}

// Maps errorType param → which errorCounts key must be > 0
const ERROR_TYPE_MAP = {
  meta: (ec) => ec.meta > 0,
  content: (ec) => ec.content > 0,
  image: (ec) => ec.image > 0,
  url: (ec) => ec.url > 0,
  technical: (ec) => ec.technical > 0,
  all: (ec) => Object.values(ec).some((v) => v > 0),
};

function buildErrorFilter(errorType) {
  return ERROR_TYPE_MAP[errorType] ?? null;
}

// Pure fetch-and-join — no scoring logic here
function buildFetchPipeline(baseQuery) {
  return [
    { $match: baseQuery },
    { $project: { pageUrl: 1, seoScore: 1 } },

    {
      $lookup: {
        from: "webpage_contents",
        let: { id: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$webpageCoreId", "$$id"] } } },
          {
            $project: {
              _id: 0,
              title: 1,
              titleLength: 1,
              metaDescription: 1,
              metaDescriptionLength: 1,
            },
          },
          { $limit: 1 },
        ],
        as: "content",
      },
    },
    { $set: { content: { $first: "$content" } } },

    {
      $lookup: {
        from: "webpage_technical",
        let: { id: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$webpageCoreId", "$$id"] } } },
          {
            $project: {
              _id: 0,
              links: 1,
              "technicalSeo.canonicalTagExists": 1,
              "performance.mobileResponsive": 1,
            },
          },
          { $limit: 1 },
        ],
        as: "technical",
      },
    },
    { $set: { technical: { $first: "$technical" } } },

    {
      $lookup: {
        from: "webpage_analysis",
        let: { id: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$webpageCoreId", "$$id"] } } },
          {
            $project: {
              _id: 0,
              "images.altMissingCount": 1,
              hasTitleDuplicates: {
                $gt: [
                  { $size: { $ifNull: ["$duplicates.titleDuplicates", []] } },
                  0,
                ],
              },
              hasDescDuplicates: {
                $gt: [
                  {
                    $size: {
                      $ifNull: ["$duplicates.descriptionDuplicates", []],
                    },
                  },
                  0,
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "analysis",
      },
    },
    { $set: { analysis: { $first: "$analysis" } } },

    {
      $lookup: {
        from: "webpage_scores",
        let: { id: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$webpageCoreId", "$$id"] } } },
          { $project: { _id: 0, scores: 1 } },
          { $limit: 1 },
        ],
        as: "scores",
      },
    },
    { $set: { scores: { $first: "$scores" } } },
  ];
}


const calculateErrorCounts = (wp) => {
    const content = wp.contentId || {};
    const analysis = wp.analysisId || {};
    const technical = wp.technicalId || {};
    const scores = wp.scoresId?.scores || {};
  
    return {
      meta: [
        !content.title?.trim(),
        (content.titleLength < 40 || content.titleLength > 60),
        !content.metaDescription?.trim(),
        (content.metaDescriptionLength < 120 || content.metaDescriptionLength > 160),
        analysis.hasTitleDuplicates,
        analysis.hasDescDuplicates
      ].filter(Boolean).length,
  
      content: [
        (content.wordCount > 0 && content.wordCount < 200),
        (analysis.contentQuality?.totalLanguageErrors > 0),
        (content.headingStructure?.h1Count !== 1),
        (content.headingsProperOrder === false || scores.headingsProperOrder === 0),
        analysis.hasContentDuplicates
      ].filter(Boolean).length,
  
      image: (analysis.images?.altMissingCount > 0) ? 1 : 0,
  
      url: [
        (wp.pageUrl?.length > 100),
        (technical.links?.internalBrokenLinksCount > 0),
        (technical.links?.externalBrokenLinksCount > 0),
        (technical.links?.redirectLinksCount > 0)
      ].filter(Boolean).length,
  
      technical: [
        (technical.technicalSeo?.canonicalTagExists !== true),
        (technical.performance?.mobileResponsive !== true)
      ].filter(Boolean).length,
    };
  };

  const ERROR_MAP = {
    // Meta Issues
    title_not_present: { $or: [{ "content.titleMissing": true }, { "scores.scores.titleNotMissing": 0 }] },
    title_not_optimal_length: { $or: [{ "content.titleRightLength": false }, { "scores.scores.titleRightLength": 0 }] },
    meta_description_not_present: { $or: [{ "content.metaDescriptionMissing": true }, { "scores.scores.metaDescNotMissing": 0 }] },
    meta_description_not_optimal_length: { $or: [{ "content.metaDescriptionRightLength": false }, { "scores.scores.metaDescRightLength": 0 }] },
    multiple_title_tags: { $or: [{ "content.multipleTitles": true }, { "scores.scores.noMultipleTitles": 0 }] },
    duplicate_title_tags: { $or: [{ "content.titleDuplicated": true }, { "scores.scores.titleNotDuplicated": 0 }] },
    duplicate_meta_descriptions: { $or: [{ "content.metaDescriptionDuplicated": true }, { "scores.scores.metaDescNotDuplicated": 0 }] },
    
    // Content Issues
    content_too_short: { $or: [{ "content.contentTooShort": true }, { "scores.scores.contentNotTooShort": 0 }] },
    spelling_errors: { $or: [{ "analysis.contentQuality.spellingErrorsCount": { $gt: 0 } }, { "scores.scores.noGrammarSpellingErrors": 0 }] },
    h1_not_present: { $or: [{ "content.oneH1Only": false }, { "scores.scores.oneH1Only": 0 }] },
    headings_not_proper_order: { $or: [{ "content.headingsProperOrder": false }, { "scores.scores.headingsProperOrder": 0 }] },
    duplicate_content: { "scores.scores.contentNotDuplicated": 0 },
  
    // Technical & Links
    images_missing_alt: { "scores.scores.imagesHaveAltText": 0 },
    redirect_links: { "technical.links.redirectLinksCount": { $gt: 0 } },
    internal_broken_links: { $or: [{ "technical.links.internalBrokenLinksCount": { $gt: 0 } }, { "scores.scores.noInternalBrokenLinks": 0 }] },
    external_broken_links: { $or: [{ "technical.links.externalBrokenLinksCount": { $gt: 0 } }, { "scores.scores.noExternalBrokenLinks": 0 }] },
    url_not_optimal_length: { $or: [{ "content.urlTooLong": true }, { "scores.scores.urlNotTooLong": 0 }] },
    canonical_tag_missing: { $or: [{ "technical.technicalSeo.canonicalTagExists": false }, { "scores.scores.canonicalTagExists": 0 }] },
    not_mobile_responsive: { $or: [{ "technical.performance.mobileResponsive": false }, { "scores.scores.mobileResponsive": 0 }] },
  };

  module.exports = {
    getErrorCounts,
    buildErrorFilter,
    buildFetchPipeline,
    calculateErrorCounts,
    ERROR_MAP,
  };