const axios = require("axios");
const Sitemapper = require("sitemapper");
const { URL } = require("url");
const { Sitemap } = require("../models/webpage-models");
const logger = require("../config/logger");

class SitemapService {
  constructor() {
    this.userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    ];
    this.stats = {
      sitemapsProcessed: 0,
      urlsExtracted: 0,
      errors: 0,
    };

    this.processedSitemaps = new Set();
  }

  async findSitemaps(websiteUrl) {
    try {
      const sitemaps = [];
      const baseUrl = this.normalizeUrl(websiteUrl);

      logger.info(`Looking for sitemaps at ${baseUrl}`);

      const sitemapUrls = await this.findSitemapsWithSitemapper(baseUrl);
      sitemaps.push(...sitemapUrls);

      try {
        const robotsSitemaps = await this.findSitemapsInRobots(baseUrl);
        robotsSitemaps.forEach((sitemap) => {
          if (!sitemaps.includes(sitemap)) {
            sitemaps.push(sitemap);
          }
        });
      } catch (error) {
        logger.debug("Error checking robots.txt", error);
      }

      if (sitemaps.length === 0) {
        const commonSitemaps = await this.checkCommonSitemapLocations(baseUrl);
        sitemaps.push(...commonSitemaps);
      }

      logger.info(`Found ${sitemaps.length} sitemaps for ${websiteUrl}`);

      if (sitemaps.length === 0) {
        logger.warn(
          `⚠️  No sitemaps found for ${websiteUrl}. The website may not have XML sitemaps.`
        );
      }

      return sitemaps;
    } catch (error) {
      logger.error("Error finding sitemaps", error);
      return [];
    }
  }

  async findSitemapsWithSitemapper(baseUrl) {
    const sitemaps = [];

    const commonPaths = [
      "/sitemap.xml",
      "/sitemap_index.xml",
      "/sitemaps.xml",
      "/sitemap1.xml",
      "/wp-sitemap.xml",
      "/post-sitemap.xml",
      "/page-sitemap.xml",
      "/xmlsitemap.php",
    ];

    for (const path of commonPaths) {
      try {
        const sitemapUrl = baseUrl + path;
        const exists = await this.checkSitemapExists(sitemapUrl);
        if (exists) {
          sitemaps.push(sitemapUrl);
          logger.debug(`Found valid sitemap: ${sitemapUrl}`);
        }
      } catch (error) {
        logger.debug(`Sitemap not found at ${path}: ${error.message}`);
      }
    }

    return sitemaps;
  }

  async findSitemapsInRobots(baseUrl) {
    try {
      const robotsUrl = baseUrl + "/robots.txt";
      const response = await axios.get(robotsUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
        },
      });

      const sitemaps = [];
      const lines = response.data.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith("sitemap:")) {
          const sitemapUrl = trimmed.substring(8).trim();
          if (sitemapUrl && this.isValidUrl(sitemapUrl)) {
            sitemaps.push(sitemapUrl);
          }
        }
      }

      return sitemaps;
    } catch (error) {
      logger.debug("Could not fetch robots.txt", error);
      return [];
    }
  }

  async checkCommonSitemapLocations(baseUrl) {
    const sitemaps = [];
    const commonPaths = [
      "/sitemap.xml",
      "/sitemap_index.xml",
      "/wp-sitemap.xml",
      "/xmlsitemap.php",
    ];

    for (const path of commonPaths) {
      try {
        const sitemapUrl = baseUrl + path;
        const exists = await this.checkSitemapExists(sitemapUrl);
        if (exists) {
          sitemaps.push(sitemapUrl);
        }
      } catch (error) {
        logger.debug(`Error checking ${path}`, error);
      }
    }

    return sitemaps;
  }

  async checkSitemapExists(sitemapUrl) {
    try {
      const response = await axios.get(sitemapUrl, {
        timeout: 8000,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        validateStatus: (status) => status < 500,
        maxRedirects: 5,
      });

      const contentType = response.headers["content-type"] || "";
      const isXML =
        contentType.includes("xml") ||
        contentType.includes("text/xml") ||
        contentType.includes("application/xml");

      const content = response.data.toString();
      const looksLikeXML =
        content.trim().startsWith("<?xml") ||
        content.includes("<urlset") ||
        content.includes("<sitemapindex");

      if (response.status === 200 && (isXML || looksLikeXML)) {
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  async isSitemapIndex(sitemapUrl, userId = null) {
    try {
      console.log(`🔍 [isSitemapIndex] Checking: ${sitemapUrl}`);

      const response = await axios.get(sitemapUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      // CRITICAL: Validate response is XML
      const contentType = response.headers["content-type"] || "";
      const content = response.data.toString();

      if (
        !contentType.includes("xml") &&
        !content.trim().startsWith("<?xml") &&
        !content.includes("<urlset") &&
        !content.includes("<sitemapindex")
      ) {
        console.log(
          `❌ [isSitemapIndex] ${sitemapUrl} returned HTML/non-XML content`
        );
        return false;
      }

      const contentLower = content.toLowerCase();
      const isIndex = contentLower.includes("<sitemapindex");

      console.log(
        `${isIndex ? "✓" : "✗"} [isSitemapIndex] ${sitemapUrl} is ${
          isIndex ? "INDEX" : "REGULAR"
        }`
      );

      return isIndex;
    } catch (error) {
      console.error(
        `❌ [isSitemapIndex] Error for ${sitemapUrl}:`,
        error.message
      );
      return false;
    }
  }

  async extractChildSitemaps(sitemapIndexUrl, userId = null) {
    try {
      console.log(`📑 [extractChildSitemaps] Processing: ${sitemapIndexUrl}`);

      const response = await axios.get(sitemapIndexUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        maxRedirects: 5,
      });

      console.log(
        `[extractChildSitemaps] Response size: ${response.data.length} bytes`
      );

      const childSitemaps = [];
      const locRegex = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
      let match;
      let count = 0;

      while ((match = locRegex.exec(response.data)) !== null) {
        count++;
        let url = match[1].trim();

        // CRITICAL FIX: Decode HTML entities (&amp; -> &)
        url = url.replace(/&amp;/g, "&");

        if (url && this.isValidUrl(url)) {
          if (url !== sitemapIndexUrl) {
            childSitemaps.push(url);
            console.log(
              `  ✓ [extractChildSitemaps] Found child #${count}: ${url}`
            );
          }
        }
      }

      const uniqueChildSitemaps = [...new Set(childSitemaps)];

      console.log(
        `✓ [extractChildSitemaps] Total: ${uniqueChildSitemaps.length} unique children`
      );

      return uniqueChildSitemaps;
    } catch (error) {
      console.error(`❌ [extractChildSitemaps] Error:`, error.message);
      return [];
    }
  }

  async extractUrlsFromSitemaps(sitemapUrls, userId = null) {
    try {
      console.log(
        `\n🚀 [extractUrlsFromSitemaps] START - Processing ${sitemapUrls.length} sitemaps`
      );
      console.log(`[extractUrlsFromSitemaps] Input URLs:`, sitemapUrls);

      this.processedSitemaps.clear();

      const allUrls = [];
      const failedSitemaps = [];

      // Step 1: Expand indexes
      console.log(
        `\n📋 [extractUrlsFromSitemaps] STEP 1: Expanding sitemap indexes...`
      );
      const urlsToExtract = await this.expandSitemapIndexes(
        sitemapUrls,
        userId
      );

      console.log(
        `\n📊 [extractUrlsFromSitemaps] Expansion complete: ${sitemapUrls.length} → ${urlsToExtract.length} sitemaps`
      );
      console.log(`[extractUrlsFromSitemaps] Expanded list:`, urlsToExtract);

      // Step 2: Extract URLs
      console.log(
        `\n📋 [extractUrlsFromSitemaps] STEP 2: Extracting URLs from each sitemap...`
      );

      for (let i = 0; i < urlsToExtract.length; i++) {
        const sitemapUrl = urlsToExtract[i];

        if (this.processedSitemaps.has(sitemapUrl)) {
          console.log(
            `⏭️  [${i + 1}/${
              urlsToExtract.length
            }] Skipping (already processed): ${sitemapUrl}`
          );
          continue;
        }

        try {
          console.log(
            `\n🔄 [${i + 1}/${urlsToExtract.length}] Processing: ${sitemapUrl}`
          );
          const urls = await this.extractUrlsFromSingleSitemap(
            sitemapUrl,
            userId
          );

          console.log(
            `✓ [${i + 1}/${urlsToExtract.length}] Extracted ${
              urls.length
            } URLs from ${sitemapUrl}`
          );

          if (urls.length > 0) {
            allUrls.push(...urls);
            console.log(`  Sample URLs:`, urls.slice(0, 3));
          }

          this.stats.sitemapsProcessed++;
          this.processedSitemaps.add(sitemapUrl);
        } catch (error) {
          this.stats.errors++;
          failedSitemaps.push({ url: sitemapUrl, error: error.message });
          console.error(
            `✗ [${i + 1}/${urlsToExtract.length}] FAILED: ${sitemapUrl}`,
            error.message
          );
        }
      }

      if (failedSitemaps.length > 0) {
        console.warn(
          `\n⚠️  [extractUrlsFromSitemaps] Failed sitemaps: ${failedSitemaps.length}`
        );
      }

      console.log(
        `\n📊 [extractUrlsFromSitemaps] Raw extraction: ${allUrls.length} URLs`
      );

      // Step 3: Filter and dedupe
      const uniqueUrls = [...new Set(allUrls)].filter((url) =>
        this.isValidPageUrl(url)
      );
      this.stats.urlsExtracted = uniqueUrls.length;

      console.log(
        `✅ [extractUrlsFromSitemaps] COMPLETE: ${
          uniqueUrls.length
        } valid URLs (removed ${
          allUrls.length - uniqueUrls.length
        } duplicates/invalid)`
      );

      return uniqueUrls;
    } catch (error) {
      console.error(
        "❌ [extractUrlsFromSitemaps] CRITICAL ERROR:",
        error.message
      );
      console.error(error.stack);
      throw error;
    }
  }

  async expandSitemapIndexes(
    sitemapUrls,
    userId = null,
    depth = 0,
    maxDepth = 3
  ) {
    if (depth >= maxDepth) {
      console.warn(`⚠️  [expandSitemapIndexes] Max depth ${maxDepth} reached`);
      return sitemapUrls;
    }

    console.log(
      `\n🔍 [expandSitemapIndexes] Depth ${depth}: Processing ${sitemapUrls.length} sitemaps`
    );

    const expandedSitemaps = [];

    for (let i = 0; i < sitemapUrls.length; i++) {
      const sitemapUrl = sitemapUrls[i];

      try {
        console.log(
          `\n[expandSitemapIndexes] [${i + 1}/${
            sitemapUrls.length
          }] Checking: ${sitemapUrl}`
        );
        const isIndex = await this.isSitemapIndex(sitemapUrl, userId);

        if (isIndex) {
          console.log(
            `📑 [expandSitemapIndexes] INDEX FOUND at depth ${depth}`
          );
          const childSitemaps = await this.extractChildSitemaps(
            sitemapUrl,
            userId
          );

          if (childSitemaps.length > 0) {
            console.log(
              `  ↳ [expandSitemapIndexes] Expanding ${childSitemaps.length} children recursively...`
            );

            const furtherExpanded = await this.expandSitemapIndexes(
              childSitemaps,
              userId,
              depth + 1,
              maxDepth
            );
            expandedSitemaps.push(...furtherExpanded);
          } else {
            console.warn(
              `  ⚠️  [expandSitemapIndexes] No children found, adding index itself`
            );
            expandedSitemaps.push(sitemapUrl);
          }
        } else {
          console.log(
            `📄 [expandSitemapIndexes] Regular sitemap, adding to list`
          );
          expandedSitemaps.push(sitemapUrl);
        }
      } catch (error) {
        console.warn(
          `⚠️  [expandSitemapIndexes] Error with ${sitemapUrl}:`,
          error.message
        );
        expandedSitemaps.push(sitemapUrl);
      }
    }

    const uniqueExpanded = [...new Set(expandedSitemaps)];
    console.log(
      `✓ [expandSitemapIndexes] Depth ${depth} complete: ${sitemapUrls.length} → ${uniqueExpanded.length}`
    );

    return uniqueExpanded;
  }

  async extractUrlsFromSingleSitemap(sitemapUrl, userId = null) {
    try {
      console.log(
        `  🔧 [extractUrlsFromSingleSitemap] Trying Sitemapper library...`
      );

      const sitemapper = new Sitemapper({
        url: sitemapUrl,
        timeout: 15000,
        requestHeaders: {
          "User-Agent": this.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        retries: 2,
        rejectUnauthorized: false,
        debug: false,
      });

      const result = await sitemapper.fetch();
      const urls = result.sites || [];

      console.log(
        `  [extractUrlsFromSingleSitemap] Sitemapper result: ${urls.length} URLs`
      );

      if (urls.length === 0) {
        console.log(
          `  ⚠️  [extractUrlsFromSingleSitemap] Sitemapper returned 0, trying manual...`
        );
        const manualUrls = await this.manualSitemapParse(sitemapUrl, userId);

        if (manualUrls.length > 0) {
          console.log(
            `  ✓ [extractUrlsFromSingleSitemap] Manual success: ${manualUrls.length} URLs`
          );
          return manualUrls;
        } else {
          console.warn(
            `  ⚠️  [extractUrlsFromSingleSitemap] Manual also returned 0`
          );
        }
      }

      return urls;
    } catch (error) {
      console.error(
        `  ❌ [extractUrlsFromSingleSitemap] Sitemapper failed:`,
        error.message
      );

      try {
        console.log(
          `  🔄 [extractUrlsFromSingleSitemap] Trying manual fallback...`
        );
        const manualUrls = await this.manualSitemapParse(sitemapUrl, userId);

        if (manualUrls.length > 0) {
          console.log(
            `  ✓ [extractUrlsFromSingleSitemap] Fallback success: ${manualUrls.length} URLs`
          );
          return manualUrls;
        }
      } catch (fallbackError) {
        console.error(
          `  ❌ [extractUrlsFromSingleSitemap] Fallback failed:`,
          fallbackError.message
        );
      }

      throw new Error(
        `Failed to process sitemap ${sitemapUrl}: ${error.message}`
      );
    }
  }

  async manualSitemapParse(sitemapUrl, userId = null) {
    try {
      console.log(`    📥 [manualSitemapParse] Fetching: ${sitemapUrl}`);

      const response = await axios.get(sitemapUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          Accept: "application/xml, text/xml, */*",
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });

      console.log(
        `    [manualSitemapParse] Response: ${response.data.length} bytes, Status: ${response.status}`
      );

      // CRITICAL: Check if response is valid XML
      const content = response.data.toString();
      const contentType = response.headers["content-type"] || "";

      if (response.status !== 200) {
        console.error(
          `    ❌ [manualSitemapParse] HTTP ${response.status} for ${sitemapUrl}`
        );
        return [];
      }

      // Validate XML content
      if (
        !contentType.includes("xml") &&
        !content.trim().startsWith("<?xml") &&
        !content.includes("<urlset") &&
        !content.includes("<sitemapindex")
      ) {
        console.error(
          `    ❌ [manualSitemapParse] Response is HTML/non-XML (likely 404 page)`
        );
        console.log(`    Content preview: ${content.substring(0, 200)}`);
        return [];
      }

      const urls = [];
      const locRegex = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
      let match;
      let totalMatches = 0;
      let skippedSitemaps = 0;

      while ((match = locRegex.exec(content)) !== null) {
        totalMatches++;
        let url = match[1].trim();

        // Decode HTML entities
        url = url
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        if (url && this.isValidUrl(url)) {
          const lowerUrl = url.toLowerCase();
          const isSitemapUrl =
            lowerUrl.includes("sitemap") ||
            lowerUrl.endsWith(".xml") ||
            lowerUrl.includes("xmlsitemap.php");

          if (!isSitemapUrl) {
            urls.push(url);
          } else {
            skippedSitemaps++;
          }
        }
      }

      console.log(
        `    [manualSitemapParse] Found ${totalMatches} <loc>, ${urls.length} page URLs, ${skippedSitemaps} sitemap URLs (skipped)`
      );

      if (totalMatches === 0) {
        console.error(
          `    ⚠️ [manualSitemapParse] No <loc> tags found - likely not a valid sitemap`
        );
      }

      return urls;
    } catch (error) {
      console.error(`    ❌ [manualSitemapParse] Failed:`, error.message);
      return [];
    }
  }

  async discoverSitemaps(websiteUrl, userId = null) {
    try {
      logger.info(
        `Discovering sitemaps for ${websiteUrl} using sitemapper`,
        userId
      );

      const baseUrl = this.normalizeUrl(websiteUrl);

      const commonSitemapUrls = [
        `${baseUrl}/sitemap.xml`,
        `${baseUrl}/sitemap_index.xml`,
        `${baseUrl}/wp-sitemap.xml`,
        `${baseUrl}/sitemaps.xml`,
        `${baseUrl}/xmlsitemap.php`,
      ];

      const validSitemaps = [];

      for (const sitemapUrl of commonSitemapUrls) {
        try {
          const exists = await this.checkSitemapExists(sitemapUrl);
          if (exists) {
            validSitemaps.push(sitemapUrl);
            logger.debug(`Discovered valid sitemap: ${sitemapUrl}`, userId);
          }
        } catch (error) {
          logger.debug(`Sitemap not accessible: ${sitemapUrl}`, userId);
        }
      }

      const robotsSitemaps = await this.findSitemapsInRobots(baseUrl);
      robotsSitemaps.forEach((sitemap) => {
        if (!validSitemaps.includes(sitemap)) {
          validSitemaps.push(sitemap);
        }
      });

      logger.info(
        `Discovered ${validSitemaps.length} sitemaps for ${websiteUrl}`,
        userId
      );
      return validSitemaps;
    } catch (error) {
      logger.error("Error discovering sitemaps", error, userId);
      return [];
    }
  }

  async saveSitemapsToDb(sitemapUrls, activityId, userId) {
    try {
      logger.info(`Saving ${sitemapUrls.length} sitemaps to database`, userId);

      const sitemapIds = [];

      for (const sitemapUrl of sitemapUrls) {
        try {
          let existingSitemap = await Sitemap.findOne({
            url: sitemapUrl,
            userActivityId: activityId,
          });

          if (existingSitemap) {
            existingSitemap.status = 1;
            existingSitemap.processedAt = undefined;
            existingSitemap.errorMessage = undefined;
            existingSitemap.updatedAt = new Date();
            await existingSitemap.save();

            sitemapIds.push(existingSitemap._id);
            logger.debug(`Updated existing sitemap: ${sitemapUrl}`, userId);
          } else {
            const newSitemap = new Sitemap({
              url: sitemapUrl,
              urlType: 0,
              userActivityId: activityId,
              status: 1,
              parentSitemaps: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            const savedSitemap = await newSitemap.save();
            sitemapIds.push(savedSitemap._id);
            logger.debug(`Saved new sitemap: ${sitemapUrl}`, userId);
          }
        } catch (error) {
          logger.warn(
            `Error saving sitemap ${sitemapUrl}: ${error.message}`,
            userId
          );
        }
      }

      logger.info(`Saved ${sitemapIds.length} sitemaps to database`, userId);
      return sitemapIds;
    } catch (error) {
      logger.error("Error saving sitemaps to database", error, userId);
      return [];
    }
  }

  async saveWebpageUrlsToDb(webpageUrls, activityId, userId) {
    try {
      logger.info(
        `Saving ${webpageUrls.length} webpage URLs to database`,
        userId
      );

      const batchSize = 100;
      let savedCount = 0;

      for (let i = 0; i < webpageUrls.length; i += batchSize) {
        const batch = webpageUrls.slice(i, i + batchSize);

        const operations = batch.map((url) => ({
          updateOne: {
            filter: {
              url: url,
              userActivityId: activityId,
            },
            update: {
              $set: {
                url: url,
                urlType: 1,
                userActivityId: activityId,
                status: 1,
                updatedAt: new Date(),
              },
              $setOnInsert: {
                createdAt: new Date(),
                parentSitemaps: [],
              },
            },
            upsert: true,
          },
        }));

        try {
          const result = await Sitemap.bulkWrite(operations);
          savedCount += result.upsertedCount + result.modifiedCount;
        } catch (error) {
          logger.warn(
            `Error in batch operation for webpage URLs: ${error.message}`,
            userId
          );
        }
      }

      logger.info(`Saved ${savedCount} webpage URLs to database`, userId);
      return savedCount;
    } catch (error) {
      logger.error("Error saving webpage URLs to database", error, userId);
      return 0;
    }
  }

  async processSitemapsAndSaveUrls(sitemapUrls, activityId, userId, options = {}) {
    try {
      const maxUrls = options.maxUrls || 0; // 0 = no cap
      console.log(`\n========================================`);
      console.log(`🚀 [processSitemapsAndSaveUrls] START`);
      console.log(`========================================`);
      console.log(`Activity ID: ${activityId}`);
      console.log(`User ID: ${userId}`);
      console.log(`Input sitemaps (${sitemapUrls.length}):`, sitemapUrls);
      if (maxUrls > 0) console.log(`Max URLs cap: ${maxUrls}`);

      if (!sitemapUrls || sitemapUrls.length === 0) {
        console.error(`❌ [processSitemapsAndSaveUrls] No sitemaps provided`);
        throw new Error("No sitemaps found to process");
      }

      // CRITICAL FIX: Validate sitemaps BEFORE saving to DB
      console.log(`\n--- STEP 0: Validating sitemaps ---`);
      const validSitemaps = [];
      for (const url of sitemapUrls) {
        const isValid = await this.checkSitemapExists(url);
        if (isValid) {
          validSitemaps.push(url);
        } else {
          console.warn(`⚠️ Skipping invalid sitemap: ${url}`);
        }
      }

      if (validSitemaps.length === 0) {
        console.error(
          `\n❌ [processSitemapsAndSaveUrls] No valid XML sitemaps found!`
        );
        throw new Error(
          "No valid XML sitemaps found. All provided URLs returned HTML/error pages."
        );
      }

      console.log(
        `✓ Validated ${validSitemaps.length}/${sitemapUrls.length} sitemaps`
      );

      // Step 1: Save only valid sitemaps
      console.log(`\n--- STEP 1: Saving valid sitemaps to DB ---`);
      const sitemapIds = await this.saveSitemapsToDb(
        validSitemaps,
        activityId,
        userId
      );
      console.log(`✓ Saved ${sitemapIds.length} sitemap records`);

      // Step 2: Extract URLs
      console.log(`\n--- STEP 2: Extracting URLs from sitemaps ---`);
      const extractedUrls = await this.extractUrlsFromSitemaps(
        validSitemaps,
        userId
      );
      console.log(`✓ Extraction complete: ${extractedUrls.length} URLs`);

      // Check results
      if (extractedUrls.length === 0) {
        console.error(`\n❌ [processSitemapsAndSaveUrls] No URLs extracted!`);
        await this.updateSitemapStatuses(
          sitemapIds,
          3,
          userId,
          "No URLs found in sitemap(s) - may be empty or malformed"
        );
        throw new Error(
          "No URLs found in sitemaps. The sitemaps may be empty or contain only sitemap indexes."
        );
      }

      // Cap URLs when maxUrls is set (e.g. V2 crawl 100K limit)
      let urlsToSave = extractedUrls;
      if (maxUrls > 0 && extractedUrls.length > maxUrls) {
        urlsToSave = extractedUrls.slice(0, maxUrls);
        console.log(`✓ Capped URLs: ${extractedUrls.length} → ${urlsToSave.length}`);
      }

      // Step 3: Save webpage URLs
      console.log(`\n--- STEP 3: Saving webpage URLs to DB ---`);
      const savedUrlCount = await this.saveWebpageUrlsToDb(
        urlsToSave,
        activityId,
        userId
      );
      console.log(`✓ Saved ${savedUrlCount} webpage URL records`);

      // Step 4: Update statuses
      console.log(`\n--- STEP 4: Updating sitemap statuses ---`);
      await this.updateSitemapStatuses(sitemapIds, 2, userId);
      console.log(`✓ Updated ${sitemapIds.length} sitemap statuses`);

      console.log(`\n========================================`);
      console.log(`✅ [processSitemapsAndSaveUrls] SUCCESS`);
      console.log(`========================================\n`);

      return {
        sitemapIds,
        extractedUrls: urlsToSave,
        savedUrlCount,
        totalSitemaps: validSitemaps.length,
        totalUrls: urlsToSave.length,
        totalExtractedBeforeCap: extractedUrls.length,
        skippedSitemaps: sitemapUrls.length - validSitemaps.length,
      };
    } catch (error) {
      console.error(`\n❌❌❌ [processSitemapsAndSaveUrls] ERROR ❌❌❌`);
      console.error(`Message: ${error.message}`);
      console.error(`Stack:`, error.stack);
      throw error;
    }
  }

  async updateSitemapStatuses(sitemapIds, status, userId, errorMessage = null) {
    try {
      const updateData = {
        status,
        processedAt: new Date(),
        updatedAt: new Date(),
      };

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      await Sitemap.updateMany(
        { _id: { $in: sitemapIds } },
        { $set: updateData }
      );

      logger.debug(
        `Updated ${sitemapIds.length} sitemap statuses to ${status}`,
        userId
      );
    } catch (error) {
      logger.warn(`Error updating sitemap statuses: ${error.message}`, userId);
    }
  }

  async getSitemapStats(activityId) {
    try {
      const stats = await Sitemap.aggregate([
        { $match: { userActivityId: activityId } },
        {
          $group: {
            _id: "$urlType",
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ["$status", 1] }, 1, 0] } },
            processed: { $sum: { $cond: [{ $eq: ["$status", 2] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", 3] }, 1, 0] } },
          },
        },
      ]);

      const result = {
        sitemaps: { total: 0, pending: 0, processed: 0, failed: 0 },
        webpages: { total: 0, pending: 0, processed: 0, failed: 0 },
      };

      stats.forEach((stat) => {
        if (stat._id === 0) {
          result.sitemaps = {
            total: stat.total,
            pending: stat.pending,
            processed: stat.processed,
            failed: stat.failed,
          };
        } else if (stat._id === 1) {
          result.webpages = {
            total: stat.total,
            pending: stat.pending,
            processed: stat.processed,
            failed: stat.failed,
          };
        }
      });

      return result;
    } catch (error) {
      logger.error("Error getting sitemap stats", error);
      return null;
    }
  }

  isValidPageUrl(url) {
    try {
      const parsed = new URL(url);

      if (!["http:", "https:"].includes(parsed.protocol)) {
        return false;
      }

      const skipExtensions = [
        ".xml",
        ".txt",
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".svg",
        ".ico",
        ".css",
        ".js",
        ".json",
        ".zip",
        ".rar",
        ".mp4",
        ".mp3",
      ];
      const pathname = parsed.pathname.toLowerCase();

      if (skipExtensions.some((ext) => pathname.endsWith(ext))) {
        return false;
      }

      if (pathname.includes("sitemap") || pathname.endsWith(".xml")) {
        return false;
      }

      if (
        pathname.includes("/feed") ||
        pathname.includes("rss") ||
        pathname.includes("atom")
      ) {
        return false;
      }

      if (pathname.includes("/wp-admin") || pathname.includes("/admin")) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return url.startsWith("http://") || url.startsWith("https://");
    } catch {
      return false;
    }
  }

  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch (error) {
      return url;
    }
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getStats() {
    return {
      ...this.stats,
      avgUrlsPerSitemap:
        this.stats.sitemapsProcessed > 0
          ? (this.stats.urlsExtracted / this.stats.sitemapsProcessed).toFixed(1)
          : 0,
      errorRate:
        this.stats.sitemapsProcessed > 0
          ? ((this.stats.errors / this.stats.sitemapsProcessed) * 100).toFixed(
              1
            ) + "%"
          : "0%",
    };
  }

  resetStats() {
    this.stats = {
      sitemapsProcessed: 0,
      urlsExtracted: 0,
      errors: 0,
    };
    this.processedSitemaps.clear();
  }
}

module.exports = SitemapService;
