const axios = require("axios");
const BacklinkSummary = require("../models/BacklinkSummary");
const { BacklinkDataModel } = require("../models/BacklinkSummary");

const API_CONFIG = {
  summaryEndpoint:
    process.env.BACKLINK_API_ENDPOINT ||
    "https://api.seopowersuite.com/backlinks/v1.0/get-summary",
  backlinksEndpoint:
    "https://api.seopowersuite.com/backlinks/v1.0/get-backlinks",
  apiKey: process.env.BACKLINK_API_KEY,
  timeout: 30000,
  /** Max backlinks to store per fetch; summary can show more (e.g. 110) if API returns more */
  maxBacklinksPerFetch:
    parseInt(process.env.BACKLINK_MAX_ITEMS, 10) || 500,
};

// Utility functions
const safeNumber = (value) => {
  const num = parseInt(value) || 0;
  return isNaN(num) ? 0 : Math.max(0, num);
};

const normalizeUrl = (url) => {
  try {
    if (!url || typeof url !== "string") return "";
    const cleanUrl = url.trim().toLowerCase();
    const urlObj = new URL(
      cleanUrl.startsWith("http") ? cleanUrl : `https://${cleanUrl}`,
    );
    return `${urlObj.protocol}//${urlObj.hostname.replace(/^www\./, "")}`;
  } catch (err) {
    return url
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "")
      .replace(/^www\./, "");
  }
};

/** Normalize date to "YYYY-MM-DD" for comparison with stored string dates */
const toYYYYMMDD = (value) => {
  if (value == null || value === "") return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const sanitizeBacklinksData = (backlinks, maxItems) => {
  if (!Array.isArray(backlinks)) return [];
  const limit = maxItems ?? API_CONFIG.maxBacklinksPerFetch;
  return backlinks
    // .slice(0, limit)
    .map((item) => ({
      url_from: String(item.url_from || "").trim(),
      url_to: String(item.url_to || "").trim(),
      title: String(item.title || "").trim(),
      anchor: String(item.anchor || "").trim(),
      alt: String(item.alt || "").trim(),
      nofollow: Boolean(item.nofollow),
      image: Boolean(item.image),
      image_source: String(item.image_source || "").trim(),
      inlink_rank: safeNumber(item.inlink_rank),
      domain_inlink_rank: safeNumber(item.domain_inlink_rank),
      first_seen: String(item.first_seen || "").trim(),
      last_visited: String(item.last_visited || "").trim(),
    }))
    .filter((item) => item.url_from && item.url_to);
};

// API fetching functions
async function callSummaryAPI(websiteUrl) {
  const startTime = Date.now();

  try {
    const response = await axios({
      method: "GET",
      url: API_CONFIG.summaryEndpoint,
      params: {
        apikey: API_CONFIG.apiKey,
        target: websiteUrl,
        mode: "domain",
        output: "json",
      },
      timeout: API_CONFIG.timeout,
    });

    const responseTime = Date.now() - startTime;

    if (
      !response.data ||
      !response.data.summary ||
      !Array.isArray(response.data.summary) ||
      !response.data.summary[0]
    ) {
      throw new Error("Invalid summary API response format");
    }

    const summaryData = response.data.summary[0];

    if (typeof summaryData.backlinks === "undefined") {
      throw new Error("No backlink count found in API response");
    }

    return { data: summaryData, responseTime };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Summary API error for ${websiteUrl}:`,
      error.message,
    );
    throw new Error(`Summary API failed: ${error.message}`);
  }
}

async function callBacklinksAPI(websiteUrl) {
  const startTime = Date.now();

  try {
    const response = await axios({
      method: "GET",
      url: API_CONFIG.backlinksEndpoint,
      params: {
        apikey: API_CONFIG.apiKey,
        target: websiteUrl,
        mode: "domain",
        order_by: "inlink_rank",
        // per_domain: 1,
        limit: 500,
        output: "json",
      },
      timeout: API_CONFIG.timeout,
    });

    const responseTime = Date.now() - startTime;

    if (!response.data || !response.data.backlinks) {
      throw new Error("Invalid backlinks API response format");
    }

    const rawBacklinks = response.data.backlinks || [];
    const sanitized = sanitizeBacklinksData(rawBacklinks);
    return {
      data: sanitized,
      responseTime,
    };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Backlinks API error for ${websiteUrl}:`,
      error.message,
    );
    throw new Error(`Backlinks API failed: ${error.message}`);
  }
}

// Main service functions
async function createInitialDocument(userId, websiteUrl) {
  try {
    if (!userId || !websiteUrl) {
      throw new Error("userId and websiteUrl are required");
    }

    const normalizedUrl = normalizeUrl(websiteUrl);
    if (!normalizedUrl) {
      throw new Error("Invalid website URL provided");
    }

    // Check if document already exists
    const existingDoc = await BacklinkSummary.findOne({
      userId,
      websiteUrl: normalizedUrl,
    });

    if (existingDoc) {
      console.log(
        `[BACKLINK-SERVICE] Document already exists for ${normalizedUrl}, updating status to processing`,
      );
      existingDoc.status = "processing";
      existingDoc.processingStarted = new Date();
      existingDoc.errorMessage = null;
      await existingDoc.save();

      return {
        success: true,
        data: existingDoc,
        isNew: false,
      };
    }

    // Create new document
    const newDoc = new BacklinkSummary({
      userId,
      websiteUrl: normalizedUrl,
      status: "processing",
      processingStarted: new Date(),
    });

    const savedDoc = await newDoc.save();
    console.log(
      `[BACKLINK-SERVICE] Created initial document for ${normalizedUrl}`,
    );

    return {
      success: true,
      data: savedDoc,
      isNew: true,
    };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Error creating initial document:`,
      error.message,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

async function fetchAndUpdateBacklinkData(userId, websiteUrl) {
  const processingStartTime = Date.now();
  let document = null;

  try {
    if (!userId || !websiteUrl) {
      throw new Error("userId and websiteUrl are required");
    }

    const normalizedUrl = normalizeUrl(websiteUrl);

    // Find the document to update
    document = await BacklinkSummary.findOne({
      userId,
      websiteUrl: normalizedUrl,
    });

    if (!document) {
      throw new Error("Document not found for updating");
    }

    console.log(`[BACKLINK-SERVICE] Starting data fetch for ${normalizedUrl}`);

    // Make both API calls in parallel
    const [summaryResult, backlinksResult] = await Promise.all([
      callSummaryAPI(normalizedUrl),
      callBacklinksAPI(normalizedUrl),
    ]);
    console.log(
      `[BACKLINK-SERVICE] Backlinks API response length:`,
      backlinksResult.data.length,
    );

    const summaryData = summaryResult.data;
    // const backlinksData = backlinksResult.data;
    const totalResponseTime = Date.now() - processingStartTime;

    // Update document with fetched data
    const updateData = {
      target: summaryData.target || normalizedUrl,
      status: "completed",

      // Summary metrics
      backlinks: safeNumber(summaryData.backlinks),
      refdomains: safeNumber(summaryData.refdomains),
      subnets: safeNumber(summaryData.subnets),
      ips: safeNumber(summaryData.ips),
      nofollow_backlinks: safeNumber(summaryData.nofollow_backlinks),
      dofollow_backlinks: safeNumber(summaryData.dofollow_backlinks),
      inlink_rank: safeNumber(summaryData.inlink_rank),
      anchors: safeNumber(summaryData.anchors),
      edu_backlinks: safeNumber(summaryData.edu_backlinks),
      gov_backlinks: safeNumber(summaryData.gov_backlinks),
      domain_inlink_rank: safeNumber(summaryData.domain_inlink_rank),
      from_home_page_backlinks: safeNumber(
        summaryData.from_home_page_backlinks,
      ),
      dofollow_from_home_page_backlinks: safeNumber(
        summaryData.dofollow_from_home_page_backlinks,
      ),
      text_backlinks: safeNumber(summaryData.text_backlinks),
      dofollow_refdomains: safeNumber(summaryData.dofollow_refdomains),
      from_home_page_refdomains: safeNumber(
        summaryData.from_home_page_refdomains,
      ),
      edu_refdomains: safeNumber(summaryData.edu_refdomains),
      gov_refdomains: safeNumber(summaryData.gov_refdomains),
      dofollow_anchors: safeNumber(summaryData.dofollow_anchors),
      pages_with_backlinks: safeNumber(summaryData.pages_with_backlinks),

      // Individual backlinks data
      // backlinks_data: backlinksData,

      // API metadata
      lastFetched: new Date(),
      apiResponseTime: totalResponseTime,
      summaryApiTime: summaryResult.responseTime,
      backlinksApiTime: backlinksResult.responseTime,
      apiStatus: "success",
      processingCompleted: new Date(),
      errorMessage: null,
    };

    Object.assign(document, updateData);
    const updatedDoc = await document.save();

    // Create backlinks data
    try {
      const backlinksData = await BacklinkDataModel.insertMany(
        backlinksResult.data.map((backlink) => ({
          backlink_summary_id: updatedDoc._id,
          ...backlink,
        })),
      );
      console.log(
        `[BACKLINK-SERVICE] Created ${backlinksData.length} backlinks data`,
      );
    } catch (error) {
      console.error(
        `[BACKLINK-SERVICE] Error creating backlinks data:`,
        error.message,
      );
      throw new Error(`Error creating backlinks data: ${error.message}`);
    }

    console.log(
      `[BACKLINK-SERVICE] ✅ Successfully updated data for ${normalizedUrl} - ${updateData.backlinks} total backlinks, ${backlinksResult.data.length} individual backlinks`,
    );

    return {
      success: true,
      data: updatedDoc,
      totalBacklinks: updateData.backlinks,
      individualBacklinks: backlinksResult.data.length,
      processingTime: totalResponseTime,
    };
  } catch (error) {
    const processingTime = Date.now() - processingStartTime;
    console.error(
      `[BACKLINK-SERVICE] ❌ Error updating backlink data:`,
      error.message,
    );

    // Update document with error status
    if (document) {
      try {
        document.status = "failed";
        document.errorMessage = error.message;
        document.apiStatus = "failed";
        document.processingCompleted = new Date();
        await document.save();
      } catch (saveError) {
        console.error(
          `[BACKLINK-SERVICE] Failed to save error status:`,
          saveError.message,
        );
      }
    }

    return {
      success: false,
      error: error.message,
      processingTime,
    };
  }
}

async function getBacklinkDataForDashboard(userId, options = {}) {
  try {
    if (!userId) {
      throw new Error("userId is required");
    }

    const {
      websiteUrl,
      page = 1,
      limit = 10,
      query = "",
      firstSeenFromDate,
      firstSeenToDate,
      lastSeenFromDate,
      lastSeenToDate,
      sortBy = "inlink_rank",
      minDomainScore,
      maxDomainScore,
      linkTypes = [],
      anchorText = "",
    } = options;

    if (!websiteUrl) {
      return {
        success: false,
        error: "websiteUrl is required",
        statusCode: 400,
      };
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const backlinkDocument = await BacklinkSummary.findOne({
      userId,
      websiteUrl: `https://${websiteUrl.toLowerCase()}`,
    }).lean();

    if (!backlinkDocument) {
      return {
        success: false,
        error: "No backlink data found for this website",
        statusCode: 404,
      };
    }

    const filter = { backlink_summary_id: backlinkDocument._id };

    // Text search (domain, URL, title, anchor)
    if (query && query.trim()) {
      filter.$or = [
        { url_from: { $regex: query, $options: "i" } },
        { url_to: { $regex: query, $options: "i" } },
        { title: { $regex: query, $options: "i" } },
      ];
    }

    // Anchor text specific
    if (anchorText && anchorText.trim()) {
      filter.anchor = { $regex: anchorText, $options: "i" };
    }

    // first_seen and last_visited are stored as "YYYY-MM-DD" strings; use string comparison
    if (firstSeenFromDate || firstSeenToDate) {
      filter.first_seen = {};
      if (firstSeenFromDate) {
        const fromStr = toYYYYMMDD(firstSeenFromDate);
        if (fromStr) filter.first_seen.$gte = fromStr;
      }
      if (firstSeenToDate) {
        const toStr = toYYYYMMDD(firstSeenToDate);
        if (toStr) filter.first_seen.$lte = toStr;
      }
    }

    if (lastSeenFromDate || lastSeenToDate) {
      filter.last_visited = {};
      if (lastSeenFromDate) {
        const fromStr = toYYYYMMDD(lastSeenFromDate);
        if (fromStr) filter.last_visited.$gte = fromStr;
      }
      if (lastSeenToDate) {
        const toStr = toYYYYMMDD(lastSeenToDate);
        if (toStr) filter.last_visited.$lte = toStr;
      }
    }

    // Domain score range
    if (minDomainScore !== undefined || maxDomainScore !== undefined) {
      filter.domain_inlink_rank = {};
      if (minDomainScore !== undefined)
        filter.domain_inlink_rank.$gte = Number(minDomainScore);
      if (maxDomainScore !== undefined)
        filter.domain_inlink_rank.$lte = Number(maxDomainScore);
    }

    // Link types
    if (Array.isArray(linkTypes) && linkTypes.length > 0) {
      if (linkTypes.includes("nofollow")) filter.nofollow = true;
      if (linkTypes.includes("dofollow")) filter.nofollow = false;
    }

    const sortObject = getSortConfig(sortBy);
    // Possible reason for the error: BacklinkDataModel may be undefined.
    // We need to ensure BacklinkDataModel is properly imported/required above.
    // Example:
    // const { BacklinkDataModel } = require('../models/BacklinkSummary'); // or wherever it's defined

    if (!BacklinkDataModel) {
      throw new Error(
        "BacklinkDataModel is not defined or invalid. Check your model import.",
      );
    }

    const backlinksData = await BacklinkDataModel.find(filter)
      .skip(skip)
      .limit(limitNum)
      .sort({ [sortObject.field]: sortObject.direction })
      .lean();

    const totalCount = await BacklinkDataModel.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    // let backlinksData = backlinkDocument.backlinks_data || [];

    // General text search (domain, URL, title)
    // if (query && query.trim()) {
    //   const searchRegex = new RegExp(query.trim(), "i");
    //   backlinksData = backlinksData.filter(
    //     (backlink) =>
    //       searchRegex.test(backlink.url_from || "") ||
    //       searchRegex.test(backlink.url_to || "") ||
    //       searchRegex.test(backlink.title || "") ||
    //       searchRegex.test(backlink.anchor || "")
    //   );
    // }

    // Anchor text specific filter
    // if (anchorText && anchorText.trim()) {
    //   const anchorRegex = new RegExp(anchorText.trim(), "i");
    //   backlinksData = backlinksData.filter(backlink =>
    //     anchorRegex.test(backlink.anchor || "")
    //   );
    // }

    // Domain score range filter
    // if (minDomainScore !== undefined || maxDomainScore !== undefined) {
    //   const minScore = minDomainScore !== undefined ? parseInt(minDomainScore) : 0;
    //   const maxScore = maxDomainScore !== undefined ? parseInt(maxDomainScore) : 100;

    //   backlinksData = backlinksData.filter(backlink => {
    //     const score = backlink.domain_inlink_rank || 0;
    //     return score >= minScore && score <= maxScore;
    //   });
    // }

    // Link type filter
    // if (linkTypes && Array.isArray(linkTypes) && linkTypes.length > 0) {
    //   backlinksData = backlinksData.filter(backlink => {
    //     const isDofollow = !backlink.nofollow;
    //     const isNofollow = backlink.nofollow;

    //     if (linkTypes.includes('dofollow') && isDofollow) return true;
    //     if (linkTypes.includes('nofollow') && isNofollow) return true;

    //     return false;
    //   });
    // }

    // Date range filtering for First Seen
    // if (firstSeenFromDate || firstSeenToDate) {
    //   backlinksData = backlinksData.filter((backlink) => {
    //     if (!backlink.first_seen) return false;

    //     const backlinkDate = new Date(backlink.first_seen);
    //     if (isNaN(backlinkDate.getTime())) return false;

    //     let matches = true;

    //     if (firstSeenFromDate) {
    //       const fromDate = new Date(firstSeenFromDate);
    //       if (!isNaN(fromDate.getTime()) && backlinkDate < fromDate) {
    //         matches = false;
    //       }
    //     }

    //     if (firstSeenToDate && matches) {
    //       const toDate = new Date(firstSeenToDate);
    //       if (!isNaN(toDate.getTime())) {
    //         toDate.setDate(toDate.getDate() + 1);
    //         if (backlinkDate >= toDate) {
    //           matches = false;
    //         }
    //       }
    //     }

    //     return matches;
    //   });
    // }

    // Date range filtering for Last Seen
    // if (lastSeenFromDate || lastSeenToDate) {
    //   backlinksData = backlinksData.filter((backlink) => {
    //     if (!backlink.last_visited) return false;

    //     const backlinkDate = new Date(backlink.last_visited);
    //     if (isNaN(backlinkDate.getTime())) return false;

    //     let matches = true;

    //     if (lastSeenFromDate) {
    //       const fromDate = new Date(lastSeenFromDate);
    //       if (!isNaN(fromDate.getTime()) && backlinkDate < fromDate) {
    //         matches = false;
    //       }
    //     }

    //     if (lastSeenToDate && matches) {
    //       const toDate = new Date(lastSeenToDate);
    //       if (!isNaN(toDate.getTime())) {
    //         toDate.setDate(toDate.getDate() + 1);
    //         if (backlinkDate >= toDate) {
    //           matches = false;
    //         }
    //       }
    //     }

    //     return matches;
    //   });
    // }

    // Sorting
    function getSortConfig(sortValue) {
      switch (sortValue) {
        case "lastFetched":
          return { field: "last_visited", direction: -1 };
        case "websiteUrl":
          return { field: "url_from", direction: 1 };
        case "websiteUrl_desc":
          return { field: "url_from", direction: -1 };
        case "inlink_rank":
          return { field: "inlink_rank", direction: -1 };
        case "inlink_rank_asc":
          return { field: "inlink_rank", direction: 1 };
        case "domain_inlink_rank":
          return { field: "domain_inlink_rank", direction: -1 };
        case "domain_inlink_rank_asc":
          return { field: "domain_inlink_rank", direction: 1 };
        default:
          return { field: "inlink_rank", direction: -1 };
      }
    }

    // const sortConfig = getSortConfig(sortBy);

    // backlinksData.sort((a, b) => {
    //   let valueA = a[sortConfig.field];
    //   let valueB = b[sortConfig.field];

    //   if (sortConfig.field === "first_seen" || sortConfig.field === "last_visited") {
    //     valueA = valueA ? new Date(valueA) : new Date(0);
    //     valueB = valueB ? new Date(valueB) : new Date(0);
    //   } else if (sortConfig.field === "url_from" || sortConfig.field === "url_to") {
    //     valueA = valueA ? valueA.toLowerCase() : "";
    //     valueB = valueB ? valueB.toLowerCase() : "";
    //   } else if (typeof valueA === "string" && typeof valueB === "string") {
    //     valueA = valueA.toLowerCase();
    //     valueB = valueB.toLowerCase();
    //   } else if (typeof valueA === "boolean" && typeof valueB === "boolean") {
    //     valueA = valueA ? 1 : 0;
    //     valueB = valueB ? 1 : 0;
    //   }

    //   if (valueA == null && valueB == null) return 0;
    //   if (valueA == null) return sortConfig.direction;
    //   if (valueB == null) return -sortConfig.direction;

    //   if (valueA < valueB) return -sortConfig.direction;
    //   if (valueA > valueB) return sortConfig.direction;
    //   return 0;
    // });

    // const totalCount = backlinksData.length;
    // const paginatedBacklinks = backlinksData.slice(skip, skip + limitNum);

    // const totalPages = Math.ceil(totalCount / limitNum);
    // const hasNextPage = pageNum < totalPages;
    // const hasPrevPage = pageNum > 1;

    // const responseDocument = {
    //   ...backlinkDocument,
    //   backlinks_data: paginatedBacklinks,
    // };

    return {
      success: true,
      data: {
        documents: [{ ...backlinkDocument, backlinks_data: backlinksData }],
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          limit: limitNum,
          hasNextPage,
          hasPrevPage,
          nextPage: hasNextPage ? pageNum + 1 : null,
          prevPage: hasPrevPage ? pageNum - 1 : null,
        },
        filters: {
          query: query || null,
          anchorText: anchorText || null,
          firstSeenFromDate: firstSeenFromDate || null,
          firstSeenToDate: firstSeenToDate || null,
          lastSeenFromDate: lastSeenFromDate || null,
          lastSeenToDate: lastSeenToDate || null,
          sortBy: sortBy,
          minDomainScore: minDomainScore || null,
          maxDomainScore: maxDomainScore || null,
          linkTypes: linkTypes.length > 0 ? linkTypes : null,
        },
      },
    };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Error getting dashboard data:`,
      error.message,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

async function getUserWebsites(userId) {
  try {
    if (!userId) {
      throw new Error("userId is required");
    }

    const websites = await BacklinkSummary.find({ userId })
      .select(
        "websiteUrl status lastFetched backlinks refdomains processingCompleted",
      )
      .sort({ lastFetched: -1 })
      .lean();

    return {
      success: true,
      data: websites,
      count: websites.length,
    };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Error getting user websites:`,
      error.message,
    );
    return {
      success: false,
      error: error.message,
    };
  }
}

async function checkDataFreshness(userId, websiteUrl) {
  try {
    if (!userId || !websiteUrl) {
      throw new Error("userId and websiteUrl are required");
    }

    const normalizedUrl = normalizeUrl(websiteUrl);
    const document = await BacklinkSummary.findOne({
      userId,
      websiteUrl: normalizedUrl,
    }).select("lastFetched status");

    if (!document) {
      return { exists: false, fresh: false };
    }

    const cacheDuration =
      (process.env.BACKLINK_CACHE_DURATION_DAYS || 7) * 24 * 60 * 60 * 1000;
    const isFresh =
      document.status === "completed" &&
      document.lastFetched &&
      Date.now() - document.lastFetched.getTime() < cacheDuration;

    return {
      exists: true,
      fresh: isFresh,
      status: document.status,
      lastFetched: document.lastFetched,
      ageHours: document.lastFetched
        ? Math.round(
            (Date.now() - document.lastFetched.getTime()) / (1000 * 60 * 60),
          )
        : null,
    };
  } catch (error) {
    console.error(
      `[BACKLINK-SERVICE] Error checking data freshness:`,
      error.message,
    );
    return { exists: false, fresh: false, error: error.message };
  }
}

module.exports = {
  createInitialDocument,
  fetchAndUpdateBacklinkData,
  getBacklinkDataForDashboard,
  getUserWebsites,
  checkDataFreshness,
};
