/**
 * @param {string} scoreKey   - Key inside scores.scores (checked for === 0)
 * @param {string} field      - Document field path for the fallback condition
 * @param {*}      fieldVal   - Value to match (default true). With operator, used as the comparison value.
 * @param {string|null} op    - Mongo operator e.g. "$gt". If null, uses equality match.
 */
function scoreOrField(scoreKey, field, fieldVal = true, op = null) {
  const fieldCondition = op
    ? { [field]: { [op]: fieldVal } }
    : { [field]: fieldVal };
  return { $or: [{ [`scores.scores.${scoreKey}`]: 0 }, fieldCondition] };
}

// ─── Error Query Map ─────────────────────────────────────────────────────────

exports.ERROR_QUERIES = {
  // Meta tag issues
  title_not_present: scoreOrField("titleNotMissing", "content.titleMissing"),
  title_not_optimal_length: scoreOrField(
    "titleRightLength",
    "content.titleRightLength",
    false,
  ),
  meta_description_not_present: scoreOrField(
    "metaDescNotMissing",
    "content.metaDescriptionMissing",
  ),
  meta_description_not_optimal_length: scoreOrField(
    "metaDescRightLength",
    "content.metaDescriptionRightLength",
    false,
  ),
  multiple_title_tags: scoreOrField(
    "noMultipleTitles",
    "content.multipleTitles",
  ),
  duplicate_title_tags: scoreOrField(
    "titleNotDuplicated",
    "content.titleDuplicated",
  ),
  duplicate_meta_descriptions: scoreOrField(
    "metaDescNotDuplicated",
    "content.metaDescriptionDuplicated",
  ),

  // Content issues
  content_too_short: scoreOrField(
    "contentNotTooShort",
    "content.contentTooShort",
  ),
  spelling_errors: scoreOrField(
    "noGrammarSpellingErrors",
    "analysis.contentQuality.spellingErrorsCount",
    0,
    "$gt",
  ),
  h1_not_present: scoreOrField("oneH1Only", "content.oneH1Only", false),
  headings_not_proper_order: scoreOrField(
    "headingsProperOrder",
    "content.headingsProperOrder",
    false,
  ),
  duplicate_content: { "scores.scores.contentNotDuplicated": 0 },

  // Image issues
  images_missing_alt: { "scores.scores.imagesHaveAltText": 0 },

  // Link issues
  redirect_links: { "technical.links.redirectLinksCount": { $gt: 0 } },
  internal_broken_links: scoreOrField(
    "noInternalBrokenLinks",
    "technical.links.internalBrokenLinksCount",
    0,
    "$gt",
  ),
  external_broken_links: scoreOrField(
    "noExternalBrokenLinks",
    "technical.links.externalBrokenLinksCount",
    0,
    "$gt",
  ),
  http_links: { "technical.links.httpLinksCount": { $gt: 0 } },

  // Technical issues
  url_not_optimal_length: scoreOrField("urlNotTooLong", "content.urlTooLong"),
  canonical_tag_missing: scoreOrField(
    "canonicalTagExists",
    "technical.technicalSeo.canonicalTagExists",
    false,
  ),
  not_mobile_responsive: scoreOrField(
    "mobileResponsive",
    "technical.performance.mobileResponsive",
    false,
  ),
};

// ─── Lookup Config ───────────────────────────────────────────────────────────

const LOOKUPS = [
  {
    from: "webpage_contents",
    as: "content",
    project: {
      title: 1,
      titleLength: 1,
      metaDescription: 1,
      metaDescriptionLength: 1,
      wordCount: 1,
      "headingStructure.h1Count": 1,
      headingsProperOrder: 1,
    },
  },
  {
    from: "webpage_technical",
    as: "technical",
    project: {
      "links.internalBrokenLinksCount": 1,
      "links.externalBrokenLinksCount": 1,
      "links.redirectLinksCount": 1,
      "technicalSeo.canonicalTagExists": 1,
      "performance.mobileResponsive": 1,
    },
  },
  {
    from: "webpage_analysis",
    as: "analysis",
    project: {
      "contentQuality.totalLanguageErrors": 1,
      "images.altMissingCount": 1,
      hasTitleDuplicates: {
        $gt: [{ $size: { $ifNull: ["$duplicates.titleDuplicates", []] } }, 0],
      },
      hasDescDuplicates: {
        $gt: [
          { $size: { $ifNull: ["$duplicates.descriptionDuplicates", []] } },
          0,
        ],
      },
      hasContentDuplicates: {
        $gt: [{ $size: { $ifNull: ["$duplicates.contentDuplicates", []] } }, 0],
      },
    },
  },
  {
    from: "webpage_scores",
    as: "scores",
    project: { scores: 1 },
  },
];

exports.buildLookupStages = () => {
  return LOOKUPS.flatMap(({ from, as, project }) => [
    {
      $lookup: {
        from,
        localField: "_id",
        foreignField: "webpageCoreId",
        pipeline: [{ $limit: 1 }, { $project: project }],
        as,
      },
    },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
  ]);
};

// ─── Error Count Helpers ─────────────────────────────────────────────────────

/** Returns 1 if condition is truthy, else 0 */
const countIf = (condition) => ({ $cond: [condition, 1, 0] });

/** Returns 1 if field value is outside [min, max], else 0 */
const countIfOutOfRange = (fieldExpr, min, max) =>
  countIf({ $or: [{ $lt: [fieldExpr, min] }, { $gt: [fieldExpr, max] }] });

// ─── Error Count Expressions (mirrors original $addFields exactly) ───────────

exports.ERROR_COUNT_FIELDS = {
  meta: {
    $add: [
      // Missing title
      countIf({
        $eq: [
          {
            $strLenCP: {
              $trim: { input: { $ifNull: ["$content.title", ""] } },
            },
          },
          0,
        ],
      }),
      // Title length not in [40, 60]
      countIfOutOfRange({ $ifNull: ["$content.titleLength", 0] }, 40, 60),
      // Missing meta description
      countIf({
        $eq: [
          {
            $strLenCP: {
              $trim: { input: { $ifNull: ["$content.metaDescription", ""] } },
            },
          },
          0,
        ],
      }),
      // Meta description length not in [120, 160]
      countIfOutOfRange(
        { $ifNull: ["$content.metaDescriptionLength", 0] },
        120,
        160,
      ),
      // Duplicate titles
      countIf("$analysis.hasTitleDuplicates"),
      // Duplicate descriptions
      countIf("$analysis.hasDescDuplicates"),
    ],
  },

  content: {
    $add: [
      // Word count > 0 but < 200 (too short)
      countIf({
        $and: [
          { $gt: [{ $ifNull: ["$content.wordCount", 0] }, 0] },
          { $lt: [{ $ifNull: ["$content.wordCount", 0] }, 200] },
        ],
      }),
      // Has language errors
      countIf({
        $gt: [
          { $ifNull: ["$analysis.contentQuality.totalLanguageErrors", 0] },
          0,
        ],
      }),
      // H1 count is not exactly 1
      countIf({
        $ne: [{ $ifNull: ["$content.headingStructure.h1Count", 0] }, 1],
      }),
      // Headings in wrong order
      countIf({
        $or: [
          { $eq: ["$content.headingsProperOrder", false] },
          { $eq: ["$scores.scores.headingsProperOrder", 0] },
        ],
      }),
      // Duplicate content
      countIf("$analysis.hasContentDuplicates"),
    ],
  },

  // Images missing alt text
  image: countIf({
    $gt: [{ $ifNull: ["$analysis.images.altMissingCount", 0] }, 0],
  }),

  url: {
    $add: [
      // URL too long (> 100 chars)
      countIf({ $gt: [{ $strLenCP: { $ifNull: ["$pageUrl", ""] } }, 100] }),
      // Internal broken links
      countIf({
        $gt: [{ $ifNull: ["$technical.links.internalBrokenLinksCount", 0] }, 0],
      }),
      // External broken links
      countIf({
        $gt: [{ $ifNull: ["$technical.links.externalBrokenLinksCount", 0] }, 0],
      }),
      // Redirect links
      countIf({
        $gt: [{ $ifNull: ["$technical.links.redirectLinksCount", 0] }, 0],
      }),
    ],
  },

  technical: {
    $add: [
      // No canonical tag
      countIf({ $ne: ["$technical.technicalSeo.canonicalTagExists", true] }),
      // Not mobile responsive
      countIf({ $ne: ["$technical.performance.mobileResponsive", true] }),
    ],
  },
};
