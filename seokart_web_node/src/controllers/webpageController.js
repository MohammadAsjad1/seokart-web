const mongoose = require("mongoose");
const {
  WebpageCore,
  WebpageContent,
  WebpageTechnical,
  WebpageAnalysis,
  WebpageScores,
  WebpageService,
  Sitemap,
} = require("../models/webpage-models");
const { UserActivity } = require("../models/activity-models");
const socketService = require("../services/socketService");

const getPaginatedWebpages = async (req, res) => {
  try {
    const { activityId } = req.params;
    const {
      page = 1,
      limit = 10,
      sort = "lastCrawled",
      order = "desc",
      filter,
      include = "all",
      search,
    } = req.query;

    const userId = req.user.id;

    const userActivity = await UserActivity.findOne({
      userId,
      _id: activityId,
    }).lean();

    if (!userActivity) {
      return res.status(404).json({
        success: false,
        message: "No crawl activity found for this website",
      });
    }

    const query = {
      userId: new mongoose.Types.ObjectId(userId),
      userActivityId: new mongoose.Types.ObjectId(activityId),
    };

    if (filter) {
      let filterObj = null;

      try {
        filterObj = JSON.parse(filter);
      } catch {
        filterObj = { search: filter };
      }

      if (filterObj.statusCode) {
        query.statusCode = filterObj.statusCode;
      }

      if (filterObj.contentType) {
        query.contentType = { $regex: filterObj.contentType, $options: "i" };
      }

      if (filterObj.hasError !== undefined) {
        query.hasError = filterObj.hasError;
      }

      if (filterObj.url) {
        query.$or = [
          { url: { $regex: filterObj.url, $options: "i" } },
          { pageUrl: { $regex: filterObj.url, $options: "i" } },
          { websiteUrl: { $regex: filterObj.websiteUrl, $options: "i" } },
        ];
      }

      if (filterObj.search) {
        query.$or = [
          { url: { $regex: filterObj.search, $options: "i" } },
          { pageUrl: { $regex: filterObj.search, $options: "i" } },
          { websiteUrl: { $regex: filterObj.search, $options: "i" } },
        ];
      }

      if (filterObj.seoGrade) {
        query.seoGrade = {
          $in: Array.isArray(filterObj.seoGrade)
            ? filterObj.seoGrade
            : [filterObj.seoGrade],
        };
      }

      if (filterObj.hasErrors !== undefined) {
        query.hasErrors = filterObj.hasErrors;
      }

      if (filterObj.seoScoreRange) {
        query.seoScore = {
          $gte: filterObj.seoScoreRange.min || 0,
          $lte: filterObj.seoScoreRange.max || 100,
        };
      }

      if (filterObj.isProcessed !== undefined) {
        query.isProcessed = filterObj.isProcessed;
      }

      if (filterObj.websiteUrl) {
        query.websiteUrl = { $regex: filterObj.websiteUrl, $options: "i" };
      }

      if (filterObj.pageUrl) {
        query.pageUrl = { $regex: filterObj.pageUrl, $options: "i" };
      }
    }

    if (search && search.trim() !== "") {
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          {
            $or: [
              { url: { $regex: search.trim(), $options: "i" } },
              { pageUrl: { $regex: search.trim(), $options: "i" } },
              { websiteUrl: { $regex: search.trim(), $options: "i" } },
            ],
          },
        ];
        delete query.$or;
      } else {
        query.$or = [
          { url: { $regex: search.trim(), $options: "i" } },
          { pageUrl: { $regex: search.trim(), $options: "i" } },
          { websiteUrl: { $regex: search.trim(), $options: "i" } },
        ];
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let projection = {
      websiteUrl: 1,
      pageUrl: 1,
      url: 1,
      crawledAt: 1,
      lastCrawled: 1,
      statusCode: 1,
      contentType: 1,
      hasError: 1,
      seoScore: 1,
      seoGrade: 1,
      hasErrors: 1,
      isProcessed: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    if (include !== "basic") {
      projection.contentId = 1;
      projection.technicalId = 1;
      projection.analysisId = 1;
      projection.scoresId = 1;
    }

    const sortObj = {};
    const sortOrder = order === "desc" ? -1 : 1;

    switch (sort) {
      case "lastCrawled":
      case "lastFetched":
        sortObj.lastCrawled = sortOrder;
        break;
      case "seoScore":
        sortObj.seoScore = sortOrder;
        break;
      case "statusCode":
        sortObj.statusCode = sortOrder;
        break;
      default:
        sortObj.lastCrawled = sortOrder;
    }

    sortObj._id = sortOrder;

    const webpages = await WebpageCore.find(query, projection)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await WebpageCore.countDocuments(query);

    let populatedWebpages = webpages;

    if (include !== "basic" && webpages.length > 0) {
      const webpageIds = webpages.map((w) => w._id);

      const populatePromises = [];

      if (include === "content" || include === "all") {
        populatePromises.push(
          WebpageContent.find({ webpageCoreId: { $in: webpageIds } }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "technical" || include === "all") {
        populatePromises.push(
          WebpageTechnical.find({ webpageCoreId: { $in: webpageIds } }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "analysis" || include === "all") {
        populatePromises.push(
          WebpageAnalysis.find({ webpageCoreId: { $in: webpageIds } }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "scores" || include === "all") {
        populatePromises.push(
          WebpageScores.find({ webpageCoreId: { $in: webpageIds } }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      const [contentData, technicalData, analysisData, scoresData] =
        await Promise.all(populatePromises);

      const contentMap = new Map();
      const technicalMap = new Map();
      const analysisMap = new Map();
      const scoresMap = new Map();

      if (contentData)
        contentData.forEach((item) =>
          contentMap.set(item.webpageCoreId.toString(), item)
        );
      if (technicalData)
        technicalData.forEach((item) =>
          technicalMap.set(item.webpageCoreId.toString(), item)
        );
      if (analysisData)
        analysisData.forEach((item) =>
          analysisMap.set(item.webpageCoreId.toString(), item)
        );
      if (scoresData)
        scoresData.forEach((item) =>
          scoresMap.set(item.webpageCoreId.toString(), item)
        );

      populatedWebpages = webpages.map((webpage) => {
        const result = { ...webpage };
        const webpageIdStr = webpage._id.toString();

        if (contentMap.has(webpageIdStr))
          result.content = contentMap.get(webpageIdStr);
        if (technicalMap.has(webpageIdStr))
          result.technical = technicalMap.get(webpageIdStr);
        if (analysisMap.has(webpageIdStr))
          result.analysis = analysisMap.get(webpageIdStr);
        if (scoresMap.has(webpageIdStr))
          result.scores = scoresMap.get(webpageIdStr);

        return result;
      });
    }

    const errorCounts = await getErrorCountsSummary(query);

    return res.status(200).json({
      success: true,
      data: {
        webpages: populatedWebpages,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
        errorCounts,
      },
    });
  } catch (error) {
    console.error("Error in getPaginatedWebpages:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching webpages",
      error: error.message,
    });
  }
};

/**
 * Get error counts summary (NEW FUNCTION)
 */
async function getErrorCountsSummary(baseQuery) {
  const totalPages = await WebpageCore.countDocuments(baseQuery);

  const [
    metaTagIssues,
    contentIssues,
    imageIssues,
    brokenLinkIssues,
    technicalIssues,
  ] = await Promise.all([
    getMetaTagIssuesCounts(baseQuery),
    getContentIssuesCounts(baseQuery),
    getImageIssuesCounts(baseQuery),
    getBrokenLinkIssuesCounts(baseQuery),
    getTechnicalIssuesCounts(baseQuery),
  ]);

  return {
    totalPages,
    categories: {
      metaTagIssues: {
        title: "Meta Tag Issues",
        issues: metaTagIssues,
      },
      contentIssues: {
        title: "Content Issues",
        issues: contentIssues,
      },
      imageIssues: {
        title: "Images' Issues",
        issues: imageIssues,
      },
      brokenLinkIssues: {
        title: "Broken Links Issues",
        issues: brokenLinkIssues,
      },
      technicalIssues: {
        title: "Technical Issues",
        issues: technicalIssues,
      },
    },
  };
}

/**
 * Get Meta Tag Issues counts
 */
async function getMetaTagIssuesCounts(baseQuery) {
  const pipeline = [
    { $match: baseQuery },
    {
      $lookup: {
        from: "webpage_contents",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "content",
      },
    },
    { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_scores",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "scores",
      },
    },
    { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        titleNotPresent: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.titleMissing", true] },
                  { $eq: ["$scores.scores.titleNotMissing", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        titleNotOptimalLength: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.titleRightLength", false] },
                  { $eq: ["$scores.scores.titleRightLength", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        metaDescriptionNotPresent: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.metaDescriptionMissing", true] },
                  { $eq: ["$scores.scores.metaDescNotMissing", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        metaDescriptionNotOptimalLength: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.metaDescriptionRightLength", false] },
                  { $eq: ["$scores.scores.metaDescRightLength", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        multipleTitleTags: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.multipleTitles", true] },
                  { $eq: ["$scores.scores.noMultipleTitles", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        duplicateTitleTags: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.titleDuplicated", true] },
                  { $eq: ["$scores.scores.titleNotDuplicated", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        duplicateMetaDescriptions: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.metaDescriptionDuplicated", true] },
                  { $eq: ["$scores.scores.metaDescNotDuplicated", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const result = await WebpageCore.aggregate(pipeline);
  const data = result[0] || {};

  return [
    {
      id: "title_not_present",
      title: "Title Tag is Present",
      count: data.titleNotPresent || 0,
      type: "metaTag",
    },
    {
      id: "title_not_optimal_length",
      title: "Title Tag Length is Optimal (40–60 characters)",
      count: data.titleNotOptimalLength || 0,
      type: "metaTag",
    },
    {
      id: "meta_description_not_present",
      title: "Meta Description is Present",
      count: data.metaDescriptionNotPresent || 0,
      type: "metaTag",
    },
    {
      id: "meta_description_not_optimal_length",
      title: "Meta Description Length is Optimal (120–160 characters)",
      count: data.metaDescriptionNotOptimalLength || 0,
      type: "metaTag",
    },
    {
      id: "multiple_title_tags",
      title: "Only One Title Tag Present",
      count: data.multipleTitleTags || 0,
      type: "metaTag",
    },
    {
      id: "duplicate_title_tags",
      title: "Unique Title Tag",
      count: data.duplicateTitleTags || 0,
      type: "metaTag",
    },
    {
      id: "duplicate_meta_descriptions",
      title: "Unique Meta Description",
      count: data.duplicateMetaDescriptions || 0,
      type: "metaTag",
    },
  ];
}

/**
 * Get Content Issues counts
 */
async function getContentIssuesCounts(baseQuery) {
  const pipeline = [
    { $match: baseQuery },
    {
      $lookup: {
        from: "webpage_contents",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "content",
      },
    },
    { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_analysis",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "analysis",
      },
    },
    { $unwind: { path: "$analysis", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_scores",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "scores",
      },
    },
    { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        contentTooShort: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.contentTooShort", true] },
                  { $eq: ["$scores.scores.contentNotTooShort", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        spellingErrors: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $gt: ["$analysis.contentQuality.spellingErrorsCount", 0] },
                  { $eq: ["$scores.scores.noGrammarSpellingErrors", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        h1NotPresent: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.oneH1Only", false] },
                  { $eq: ["$scores.scores.oneH1Only", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        headingsNotProperOrder: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.headingsProperOrder", false] },
                  { $eq: ["$scores.scores.headingsProperOrder", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        duplicateContent: {
          $sum: {
            $cond: [{ $eq: ["$scores.scores.contentNotDuplicated", 0] }, 1, 0],
          },
        },
      },
    },
  ];

  const result = await WebpageCore.aggregate(pipeline);
  const data = result[0] || {};

  return [
    {
      id: "content_too_short",
      title: "Content Length is Sufficient (More Than 200 Words)",
      count: data.contentTooShort || 0,
      type: "content",
    },
    {
      id: "spelling_errors",
      title: "No Spelling Errors",
      count: data.spellingErrors || 0,
      type: "content",
    },
    {
      id: "h1_not_present",
      title: "H1 Tag Present on the Top",
      count: data.h1NotPresent || 0,
      type: "content",
    },
    {
      id: "headings_not_proper_order",
      title: "Headings in Proper Order",
      count: data.headingsNotProperOrder || 0,
      type: "content",
    },
    {
      id: "duplicate_content",
      title: "No Duplicate Content Found",
      count: data.duplicateContent || 0,
      type: "content",
    },
  ];
}

/**
 * Get Image Issues counts
 */
async function getImageIssuesCounts(baseQuery) {
  const pipeline = [
    { $match: baseQuery },
    {
      $lookup: {
        from: "webpage_scores",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "scores",
      },
    },
    { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        imagesMissingAlt: {
          $sum: {
            $cond: [{ $eq: ["$scores.scores.imagesHaveAltText", 0] }, 1, 0],
          },
        },
      },
    },
  ];

  const result = await WebpageCore.aggregate(pipeline);
  const data = result[0] || {};

  return [
    {
      id: "images_missing_alt",
      title: "Images Have Alt Text",
      count: data.imagesMissingAlt || 0,
      type: "image",
    },
  ];
}

/**
 * Get Broken Link Issues counts
 */
async function getBrokenLinkIssuesCounts(baseQuery) {
  const pipeline = [
    { $match: baseQuery },
    {
      $lookup: {
        from: "webpage_technical",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "technical",
      },
    },
    { $unwind: { path: "$technical", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_scores",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "scores",
      },
    },
    { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        internalBrokenLinks: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $gt: ["$technical.links.internalBrokenLinksCount", 0] },
                  { $eq: ["$scores.scores.noInternalBrokenLinks", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        externalBrokenLinks: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $gt: ["$technical.links.externalBrokenLinksCount", 0] },
                  { $eq: ["$scores.scores.noExternalBrokenLinks", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        redirectLinks: {
          $sum: {
            $cond: [{ $gt: ["$technical.links.redirectLinksCount", 0] }, 1, 0],
          },
        },
        httpLinks: {
          $sum: {
            $cond: [{ $gt: ["$technical.links.httpLinksCount", 0] }, 1, 0],
          },
        },
      },
    },
  ];

  const result = await WebpageCore.aggregate(pipeline);
  const data = result[0] || {};

  return [
    {
      id: "redirect_links",
      title: "Redirect links",
      count: data.redirectLinks || 0,
      type: "brokenLink",
    },
    {
      id: "internal_broken_links",
      title: "No Internal Broken Links",
      count: data.internalBrokenLinks || 0,
      type: "brokenLink",
    },
    {
      id: "external_broken_links",
      title: "No External Broken Links",
      count: data.externalBrokenLinks || 0,
      type: "brokenLink",
    },
    {
      id: "http_links",
      title: "No HTTP Links (All HTTPS)",
      count: data.httpLinks || 0,
      type: "brokenLink",
    },
  ];
}

/**
 * Get Technical Issues counts
 */
async function getTechnicalIssuesCounts(baseQuery) {
  const pipeline = [
    { $match: baseQuery },
    {
      $lookup: {
        from: "webpage_contents",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "content",
      },
    },
    { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_technical",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "technical",
      },
    },
    { $unwind: { path: "$technical", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "webpage_scores",
        localField: "_id",
        foreignField: "webpageCoreId",
        as: "scores",
      },
    },
    { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        urlNotOptimalLength: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$content.urlTooLong", true] },
                  { $eq: ["$scores.scores.urlNotTooLong", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        canonicalTagMissing: {
          $sum: {
            $cond: [
              {
                $or: [
                  {
                    $eq: ["$technical.technicalSeo.canonicalTagExists", false],
                  },
                  { $eq: ["$scores.scores.canonicalTagExists", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
        notMobileResponsive: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$technical.performance.mobileResponsive", false] },
                  { $eq: ["$scores.scores.mobileResponsive", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const result = await WebpageCore.aggregate(pipeline);
  const data = result[0] || {};

  return [
    {
      id: "url_not_optimal_length",
      title: "URL Length is Optimal",
      count: data.urlNotOptimalLength || 0,
      type: "technical",
    },
    {
      id: "canonical_tag_missing",
      title: "Canonical Tag Exists",
      count: data.canonicalTagMissing || 0,
      type: "technical",
    },
    {
      id: "not_mobile_responsive",
      title: "Webpage is Mobile Responsive",
      count: data.notMobileResponsive || 0,
      type: "technical",
    },
  ];
}

/**
 * Get paginated pages for a specific error type (NEW ENDPOINT)
 */
const getErrorWebpages = async (req, res) => {
  try {
    const { activityId, errorType } = req.params;
    const {
      page = 1,
      limit = 10,
      sort = "seoScore",
      order = "asc",
    } = req.query;

    const userId = req.user.id;

    const baseQuery = {
      userId: new mongoose.Types.ObjectId(userId),
      userActivityId: new mongoose.Types.ObjectId(activityId),
      isProcessed: true,
    };

    // Build specific query based on error type
    const errorQuery = buildErrorQuery(errorType);

    if (!errorQuery) {
      return res.status(400).json({
        success: false,
        message: "Invalid error type",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = {};
    sortObj[sort] = order === "desc" ? -1 : 1;
    sortObj._id = order === "desc" ? -1 : 1;

    // Execute aggregation pipeline
    const pipeline = [
      { $match: baseQuery },
      {
        $lookup: {
          from: "webpage_contents",
          localField: "_id",
          foreignField: "webpageCoreId",
          as: "content",
        },
      },
      { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "webpage_technical",
          localField: "_id",
          foreignField: "webpageCoreId",
          as: "technical",
        },
      },
      { $unwind: { path: "$technical", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "webpage_analysis",
          localField: "_id",
          foreignField: "webpageCoreId",
          as: "analysis",
        },
      },
      { $unwind: { path: "$analysis", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "webpage_scores",
          localField: "_id",
          foreignField: "webpageCoreId",
          as: "scores",
        },
      },
      { $unwind: { path: "$scores", preserveNullAndEmptyArrays: true } },
      { $match: errorQuery },
      {
        $project: {
          // Remove internal fields but keep everything else
          userId: 0,
          userActivityId: 0,
          __v: 0,
          "content.__v": 0,
          "content.webpageCoreId": 0,
          "technical.__v": 0,
          "technical.webpageCoreId": 0,
          "analysis.__v": 0,
          "analysis.webpageCoreId": 0,
          "scores.__v": 0,
          "scores.webpageCoreId": 0,
        },
      },
      { $sort: sortObj },
    ];

    // Get total count
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await WebpageCore.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Get paginated results
    const resultPipeline = [
      ...pipeline,
      { $skip: skip },
      { $limit: parseInt(limit) },
    ];
    const webpages = await WebpageCore.aggregate(resultPipeline);

    return res.status(200).json({
      success: true,
      data: {
        errorType,
        webpages,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Error in getErrorWebpages:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching error webpages",
      error: error.message,
    });
  }
};
/**
 * Build MongoDB query for specific error type
 */
function buildErrorQuery(errorType) {
  const queries = {
    // Meta Tag Issues
    title_not_present: {
      $or: [
        { "content.titleMissing": true },
        { "scores.scores.titleNotMissing": 0 },
      ],
    },
    title_not_optimal_length: {
      $or: [
        { "content.titleRightLength": false },
        { "scores.scores.titleRightLength": 0 },
      ],
    },
    meta_description_not_present: {
      $or: [
        { "content.metaDescriptionMissing": true },
        { "scores.scores.metaDescNotMissing": 0 },
      ],
    },
    meta_description_not_optimal_length: {
      $or: [
        { "content.metaDescriptionRightLength": false },
        { "scores.scores.metaDescRightLength": 0 },
      ],
    },
    multiple_title_tags: {
      $or: [
        { "content.multipleTitles": true },
        { "scores.scores.noMultipleTitles": 0 },
      ],
    },
    duplicate_title_tags: {
      $or: [
        { "content.titleDuplicated": true },
        { "scores.scores.titleNotDuplicated": 0 },
      ],
    },
    duplicate_meta_descriptions: {
      $or: [
        { "content.metaDescriptionDuplicated": true },
        { "scores.scores.metaDescNotDuplicated": 0 },
      ],
    },

    // Content Issues
    content_too_short: {
      $or: [
        { "content.contentTooShort": true },
        { "scores.scores.contentNotTooShort": 0 },
      ],
    },
    spelling_errors: {
      $or: [
        { "analysis.contentQuality.spellingErrorsCount": { $gt: 0 } },
        { "scores.scores.noGrammarSpellingErrors": 0 },
      ],
    },
    h1_not_present: {
      $or: [{ "content.oneH1Only": false }, { "scores.scores.oneH1Only": 0 }],
    },
    headings_not_proper_order: {
      $or: [
        { "content.headingsProperOrder": false },
        { "scores.scores.headingsProperOrder": 0 },
      ],
    },
    duplicate_content: {
      "scores.scores.contentNotDuplicated": 0,
    },

    // Image Issues
    images_missing_alt: {
      "scores.scores.imagesHaveAltText": 0,
    },

    // Broken Link Issues
    redirect_links: {
      "technical.links.redirectLinksCount": { $gt: 0 },
    },
    internal_broken_links: {
      $or: [
        { "technical.links.internalBrokenLinksCount": { $gt: 0 } },
        { "scores.scores.noInternalBrokenLinks": 0 },
      ],
    },
    external_broken_links: {
      $or: [
        { "technical.links.externalBrokenLinksCount": { $gt: 0 } },
        { "scores.scores.noExternalBrokenLinks": 0 },
      ],
    },
    http_links: {
      "technical.links.httpLinksCount": { $gt: 0 },
    },

    // Technical Issues
    url_not_optimal_length: {
      $or: [
        { "content.urlTooLong": true },
        { "scores.scores.urlNotTooLong": 0 },
      ],
    },
    canonical_tag_missing: {
      $or: [
        { "technical.technicalSeo.canonicalTagExists": false },
        { "scores.scores.canonicalTagExists": 0 },
      ],
    },
    not_mobile_responsive: {
      $or: [
        { "technical.performance.mobileResponsive": false },
        { "scores.scores.mobileResponsive": 0 },
      ],
    },
  };

  return queries[errorType] || null;
}

/**
 * Optimized single webpage retrieval with selective population
 */
const getWebpageById = async (req, res) => {
  try {
    const { id } = req.params;
    const { include = "all" } = req.query;
    const userId = req.user
      ? req.user._id
      : new mongoose.Types.ObjectId("6618dde65a25055d0ff67579");

    // Get core webpage data
    const webpage = await WebpageCore.findOne({
      _id: id,
      userId,
    }).lean();

    if (!webpage) {
      return res.status(404).json({
        success: false,
        message: "Webpage not found",
      });
    }

    const result = { ...webpage };

    // Populate additional data based on include parameter
    if (include !== "basic") {
      const populatePromises = [];

      if (include === "content" || include === "all") {
        populatePromises.push(
          WebpageContent.findOne({ webpageCoreId: id }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "technical" || include === "all") {
        populatePromises.push(
          WebpageTechnical.findOne({ webpageCoreId: id }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "analysis" || include === "all") {
        populatePromises.push(
          WebpageAnalysis.findOne({ webpageCoreId: id }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      if (include === "scores" || include === "all") {
        populatePromises.push(
          WebpageScores.findOne({ webpageCoreId: id }).lean()
        );
      } else {
        populatePromises.push(Promise.resolve(null));
      }

      const [content, technical, analysis, scores] = await Promise.all(
        populatePromises
      );

      if (content) result.content = content;
      if (technical) result.technical = technical;
      if (analysis) result.analysis = analysis;
      if (scores) result.scores = scores;
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in getWebpageById:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the webpage",
      error: error.message,
    });
  }
};

/**
 * Optimized statistics with aggregation pipeline
 */
const getWebpageStats = async (req, res) => {
  try {
    const { websiteUrl } = req.params;
    const userId = req.user
      ? req.user._id
      : new mongoose.Types.ObjectId("6618dde65a25055d0ff67579");

    // Use aggregation pipeline for efficient statistics
    const statsAggregation = await WebpageCore.aggregate([
      {
        $match: {
          userId: mongoose.Types.ObjectId(userId),
          websiteUrl,
          isProcessed: true,
        },
      },
      {
        $facet: {
          // Total counts
          totalStats: [
            {
              $group: {
                _id: null,
                totalCount: { $sum: 1 },
                errorCount: {
                  $sum: { $cond: [{ $eq: ["$hasErrors", true] }, 1, 0] },
                },
                processedCount: {
                  $sum: { $cond: [{ $eq: ["$isProcessed", true] }, 1, 0] },
                },
              },
            },
          ],

          // SEO Grade distribution
          gradeDistribution: [
            {
              $group: {
                _id: "$seoGrade",
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],

          // SEO Score ranges
          scoreRanges: [
            {
              $bucket: {
                groupBy: "$seoScore",
                boundaries: [0, 30, 50, 70, 85, 95, 100],
                default: "other",
                output: { count: { $sum: 1 } },
              },
            },
          ],

          // Average scores
          averageScores: [
            {
              $group: {
                _id: null,
                avgSeoScore: { $avg: "$seoScore" },
                maxSeoScore: { $max: "$seoScore" },
                minSeoScore: { $min: "$seoScore" },
              },
            },
          ],
        },
      },
    ]);

    const stats = statsAggregation[0];

    return res.status(200).json({
      success: true,
      data: {
        summary: stats.totalStats[0] || {
          totalCount: 0,
          errorCount: 0,
          processedCount: 0,
        },
        gradeDistribution: stats.gradeDistribution,
        scoreRanges: stats.scoreRanges,
        averageScores: stats.averageScores[0] || {
          avgSeoScore: 0,
          maxSeoScore: 0,
          minSeoScore: 0,
        },
      },
    });
  } catch (error) {
    console.error("Error in getWebpageStats:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching webpage statistics",
      error: error.message,
    });
  }
};

/**
 * Search webpages with text search optimization
 */
const searchWebpages = async (req, res) => {
  try {
    const { activityId } = req.params;
    const {
      q,
      limit = 10,
      cursor,
      searchFields = ["pageUrl", "websiteUrl"],
    } = req.query;
    const userId = req.user.id;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    // Build search query
    const searchQuery = {
      userId: new mongoose.Types.ObjectId(userId),
      userActivityId: new mongoose.Types.ObjectId(activityId),
      $or: [],
    };

    // Add search conditions for specified fields
    if (searchFields.includes("pageUrl")) {
      searchQuery.$or.push({ pageUrl: { $regex: q, $options: "i" } });
    }
    if (searchFields.includes("websiteUrl")) {
      searchQuery.$or.push({ websiteUrl: { $regex: q, $options: "i" } });
    }

    // Cursor pagination for search
    if (cursor) {
      searchQuery._id = { $gt: mongoose.Types.ObjectId(cursor) };
    }

    const webpages = await WebpageCore.find(searchQuery, {
      websiteUrl: 1,
      pageUrl: 1,
      lastCrawled: 1,
      seoScore: 1,
      seoGrade: 1,
      hasErrors: 1,
      isProcessed: 1,
    })
      .sort({ _id: 1 })
      .limit(parseInt(limit) + 1)
      .lean();

    const hasNextPage = webpages.length > parseInt(limit);
    if (hasNextPage) {
      webpages.pop();
    }

    const nextCursor =
      hasNextPage && webpages.length > 0
        ? webpages[webpages.length - 1]._id
        : null;

    return res.status(200).json({
      success: true,
      data: {
        webpages,
        pagination: {
          limit: parseInt(limit),
          hasNextPage,
          nextCursor,
          count: webpages.length,
        },
        searchQuery: q,
        searchFields,
      },
    });
  } catch (error) {
    console.error("Error in searchWebpages:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while searching webpages",
      error: error.message,
    });
  }
};

/**
 * Bulk operations for webpage management
 */
const bulkUpdateWebpages = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { webpageIds, updates } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(webpageIds) || webpageIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "webpageIds array is required",
      });
    }

    // Validate ownership
    const validWebpages = await WebpageCore.find({
      _id: { $in: webpageIds },
      userId: new mongoose.Types.ObjectId(userId),
      userActivityId: new mongoose.Types.ObjectId(activityId),
    }).countDocuments();

    if (validWebpages !== webpageIds.length) {
      return res.status(403).json({
        success: false,
        message: "Some webpages do not belong to this user or activity",
      });
    }

    // Perform bulk update
    const result = await WebpageCore.updateMany(
      {
        _id: { $in: webpageIds },
        userId: new mongoose.Types.ObjectId(userId),
      },
      { $set: updates },
      { runValidators: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        updates: updates,
      },
    });
  } catch (error) {
    console.error("Error in bulkUpdateWebpages:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during bulk update",
      error: error.message,
    });
  }
};

const deleteWebsiteActivity = async (req, res) => {
  try {
    const { activityId } = req.params;
    const userId = req.user.id;

    console.log(
      `Initiating deletion for activity ID: ${activityId} by user ID: ${userId}`
    );

    // Validate activity ID
    if (!activityId || !mongoose.Types.ObjectId.isValid(activityId)) {
      return res.status(400).json({
        success: false,
        message: "Valid activity ID is required",
      });
    }

    // Step 1: Find and verify the activity belongs to the user
    const activity = await UserActivity.findOne({
      _id: activityId,
      userId,
    });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found or you don't have permission to delete it",
      });
    }

    // Check if activity is currently processing
    if (["processing", "analyzing"].includes(activity.status)) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot delete activity while crawling is in progress. Please wait for it to complete or stop it first.",
        activityStatus: activity.status,
      });
    }

    const websiteUrl = activity.websiteUrl;
    const startTime = Date.now();

    // Step 2: Find all WebpageCore documents for this activity
    const webpageCores = await WebpageCore.find({
      userActivityId: activityId,
    }).lean(); // Use lean() for better performance since we only need IDs

    const webpageCoreIds = webpageCores.map((core) => core._id);
    const totalWebpages = webpageCoreIds.length;

    console.log(
      `Found ${totalWebpages} webpages to delete for activity ${activityId}`
    );

    // Step 3: Delete all related webpage data in parallel
    const deletionResults = await Promise.allSettled([
      WebpageContent.deleteMany({
        webpageCoreId: { $in: webpageCoreIds },
      }),
      WebpageScores.deleteMany({
        webpageCoreId: { $in: webpageCoreIds },
      }),
      WebpageTechnical.deleteMany({
        webpageCoreId: { $in: webpageCoreIds },
      }),
      WebpageAnalysis.deleteMany({
        webpageCoreId: { $in: webpageCoreIds },
      }),
      WebpageCore.deleteMany({
        userActivityId: activityId,
      }),
      Sitemap.deleteMany({
        userActivityId: activityId,
      }),
    ]);

    // Check if any deletion failed
    const failedDeletions = deletionResults.filter(
      (result) => result.status === "rejected"
    );

    if (failedDeletions.length > 0) {
      console.error(
        "Some deletions failed:",
        failedDeletions.map((f) => f.reason?.message)
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to delete some associated data. Please try again or contact support.",
        errors: failedDeletions.map((f) => f.reason?.message),
      });
    }

    // Extract deletion counts
    const [
      contentDeleted,
      scoresDeleted,
      technicalDeleted,
      analysisDeleted,
      coresDeleted,
      sitemapsDeleted,
    ] = deletionResults.map((result) =>
      result.status === "fulfilled" ? result.value.deletedCount : 0
    );

    console.log("Deletion counts:", {
      contents: contentDeleted,
      scores: scoresDeleted,
      technical: technicalDeleted,
      analysis: analysisDeleted,
      cores: coresDeleted,
      sitemaps: sitemapsDeleted,
    });

    // Step 4: Delete the UserActivity (delete parent last)
    const activityDeletion = await UserActivity.deleteOne({ _id: activityId });

    if (activityDeletion.deletedCount === 0) {
      console.error(`Failed to delete UserActivity ${activityId}`);
      return res.status(500).json({
        success: false,
        message: "Failed to delete the activity record",
      });
    }

    const processingTime = Date.now() - startTime;

    console.log(
      `Successfully deleted activity ${activityId} in ${processingTime}ms`
    );

    // Emit socket event for activity deletion (non-blocking)
    try {
      if (socketService.emitActivityDeleted) {
        socketService.emitActivityDeleted(userId, {
          activityId,
          websiteUrl,
          message: "Activity and all associated data deleted successfully",
        });
      }

      // Emit updated activities list
      await emitUserActivitiesUpdate(userId);
    } catch (socketError) {
      // Don't fail the request if socket emission fails
      console.error("Socket emission error:", socketError.message);
    }

    return res.status(200).json({
      success: true,
      message: "Activity and all associated data deleted successfully",
      data: {
        activityId,
        websiteUrl,
        deletionSummary: {
          webpageCores: coresDeleted,
          webpageContents: contentDeleted,
          webpageScores: scoresDeleted,
          webpageTechnical: technicalDeleted,
          webpageAnalysis: analysisDeleted,
          sitemaps: sitemapsDeleted,
          userActivity: 1,
        },
        totalWebpagesDeleted: totalWebpages,
        processingTime: `${processingTime}ms`,
      },
    });
  } catch (error) {
    console.error("Error deleting activity:", error);

    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting the activity",
      error:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error.message,
    });
  }
};

module.exports = {
  getPaginatedWebpages,
  getWebpageById,
  getWebpageStats,
  searchWebpages,
  bulkUpdateWebpages,
  getErrorWebpages,
  deleteWebsiteActivity,
};
