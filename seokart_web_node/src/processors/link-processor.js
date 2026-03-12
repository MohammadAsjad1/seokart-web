const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const { URL } = require("url");
const logger = require("../config/logger");
const pLimit = require("p-limit").default;
const config = require("../config/scraper");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

class LinkProcessor {
  constructor(options = {}) {
    this.redis = options.redis ?? null;
    this.stats = {
      linksChecked: 0,
      internalBrokenLinksFound: 0,
      externalBrokenLinksFound: 0,
      redirectLinksFound: 0,
      errors: 0,
      linkCacheHits: 0,
      linkCacheMisses: 0,
    };
    this.timeout = config.timeouts?.link_check ?? 3000;
    this.maxRedirects = 5;
    this.domainCache = new Map();
    this.DOMAIN_CACHE_TTL = 60000;
    this._cacheConfig = config.link_validation_cache || {};
    this._redisGet = this.redis ? this.redis.get.bind(this.redis) : null;
    this._redisSet = this.redis ? this.redis.set.bind(this.redis) : null;
  }

  async validatePageLinks(webpage, options = {}) {
    try {
      const pageUrl = webpage.pageUrl || webpage.url;
      const websiteUrl = webpage.websiteUrl;

      let startTime = Date.now();

      logger.info(`🔍 Starting link validation for: ${pageUrl}`);
      let links = await this.extractLinksFromWebpage(webpage, pageUrl);
      let endTime = Date.now();
      let duration = endTime - startTime;
      logger.debug(`🔍 Link extraction time: ${duration}ms`);
      if (!links || links.length === 0) {
        logger.warn(`⚠️  No links found on: ${pageUrl}`);
        return {
          internalBrokenLinks: [],
          externalBrokenLinks: [],
          redirectLinks: [],
        };
      }

      // const maxPerPage = config.performance?.link_validation_max_links_per_page;
      // if (maxPerPage && maxPerPage > 0 && links.length > maxPerPage) {
      //   links = links.slice(0, maxPerPage);
      //   logger.info(`📊 Capping to ${maxPerPage} links per page (had more) for: ${pageUrl}`);
      // } else {
      //   logger.info(`📊 Found ${links.length} unique links to validate on: ${pageUrl}`);
      // }

      startTime = Date.now();
      const results = await this.validateLinksWithRateLimit(
        links,
        pageUrl,
        websiteUrl,
        options
      );
      endTime = Date.now();
      duration = endTime - startTime;
      logger.debug(`🔍 Link validation time: ${duration}ms`);
      logger.info(
        `✅ Link validation complete for ${pageUrl}: ` +
          `${results.internalBrokenLinks.length} internal broken, ` +
          `${results.externalBrokenLinks.length} external broken, ` +
          `${results.redirectLinks.length} redirects`,
      );

      return results;
    } catch (error) {
      this.stats.errors++;
      logger.error(`❌ Error validating page links for ${webpage.pageUrl}:`, error);
      return {
        internalBrokenLinks: [],
        externalBrokenLinks: [],
        redirectLinks: [],
      };
    }
  }

  async extractLinksFromWebpage(webpage, pageUrl) {
    try {
      let links = [];

      // Method 1: Try to get from stored links data
      const linksData = webpage.links || webpage.technical?.links;
      
      if (linksData && linksData.allLinks && Array.isArray(linksData.allLinks) && linksData.allLinks.length > 0) {
        logger.info(`📦 Using ${linksData.allLinks.length} stored links from database`);
        links = linksData.allLinks;
      } else {
        // Method 2: Fetch and parse the page HTML
        logger.info(`🌐 No stored links found, fetching page HTML to extract links...`);
        
        try {
          const response = await axios.get(pageUrl, {
            timeout: this.timeout,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            maxRedirects: 5,
          });

          const $ = cheerio.load(response.data);
          const extractedLinks = [];

          $('a[href]').each((i, elem) => {
            const href = $(elem).attr('href');
            const text = $(elem).text().trim();
            
            if (href && href.trim()) {
              extractedLinks.push({
                url: href.trim(),
                href: href.trim(),
                text: text || href.trim()
              });
            }
          });

          logger.info(`🔗 Extracted ${extractedLinks.length} links from HTML`);
          links = extractedLinks;

        } catch (fetchError) {
          logger.error(`❌ Failed to fetch page for link extraction: ${fetchError.message}`);
          return [];
        }
      }

      // ====== updated, already storing the unique links while scraping =======
      // Clean up and remove duplicates
      // const uniqueLinks = [];
      // const seenUrls = new Set();

      // for (const link of links) {
      //   const url = link.url || link.href;
      //   if (!url) continue;

      //   if (this.shouldSkipLink(url)) {
      //     continue;
      //   }

      //   const resolvedUrl = this.resolveUrl(url, pageUrl);
      //   if (!resolvedUrl) continue;

      //   if (!seenUrls.has(resolvedUrl)) {
      //     seenUrls.add(resolvedUrl);
      //     uniqueLinks.push({
      //       url: resolvedUrl,
      //       href: resolvedUrl,
      //       text: link.text || url
      //     });
      //   }
      // }

      // logger.info(`✨ Returning ${uniqueLinks.length} unique valid links for validation`);
      // return uniqueLinks;
      return links;

    } catch (error) {
      logger.error("❌ Error extracting links from webpage:", error);
      return [];
    }
  }

  async validateLinksWithRateLimit(links, pageUrl, websiteUrl, options = {}) {
    if (!links.length) return { internalBrokenLinks: [], externalBrokenLinks: [], redirectLinks: [] };
  
    const internalBrokenLinks = [];
    const externalBrokenLinks = [];
    const redirectLinks = [];
  
    const perPageConcurrency =
      config.concurrency?.link_checks_per_page != null
        ? config.concurrency.link_checks_per_page
        : 40;
    const limit = pLimit(perPageConcurrency);
  
    await Promise.allSettled(
      links.map(link =>
        limit(async () => {
          try {
            const result = await this.validateLink(link, pageUrl, websiteUrl, options);
            if (!result) return;
  
            if (result.isRedirect) {
              redirectLinks.push(result);
            } else if (result.isBroken) {
              (result.type === "internal" ? internalBrokenLinks : externalBrokenLinks).push(result);
            }
          } catch (err) {
            logger.warn(`⚠️ Failed to validate link "${link}": ${err.message}`);
          }
        })
      )
    );
  
    logger.info(
      `📈 Validation complete: ${internalBrokenLinks.length} internal broken, ` +
      `${externalBrokenLinks.length} external broken, ${redirectLinks.length} redirects`
    );
  
    return { internalBrokenLinks, externalBrokenLinks, redirectLinks };
  }

  async validateLink(link, pageUrl, websiteUrl, options = {}) {
    try {
      this.stats.linksChecked++;

      const linkUrl = link.url || link.href;
      const linkText = link.text || "";

      if (!linkUrl) {
        return null;
      }

      if (this.shouldSkipLink(linkUrl)) {
        return null;
      }

      const absoluteUrl = this.resolveUrl(linkUrl, pageUrl);
      
      if (!absoluteUrl) {
        return null;
      }

      const linkType = this.getLinkType(absoluteUrl, websiteUrl);
      const linkStatus = await this.checkLinkStatus(absoluteUrl, this.timeout, options);

      if (linkStatus.isRedirect) {
        return {
          url: absoluteUrl,
          text: linkText,
          redirectTo: linkStatus.redirectTo,
          statusCode: linkStatus.statusCode,
          type: linkType,
          isRedirect: true,
          isBroken: false,
        };
      }

      if (linkStatus.isBroken) {
        return {
          url: absoluteUrl,
          text: linkText,
          error: linkStatus.error,
          statusCode: linkStatus.statusCode,
          type: linkType,
          isBroken: true,
          isRedirect: false,
        };
      }

      return null;
    } catch (error) {
      logger.debug(`Error validating link ${link.url}: ${error.message}`);
      return null;
    }
  }

  parseResponse({ status, headers }) {
    if (REDIRECT_STATUSES.has(status)) {
      return { isBroken: false, isRedirect: true, statusCode: status, redirectTo: headers.location || "" };
    }
    if (status >= 400 && status !== 403) {
      return { isBroken: true, isRedirect: false, statusCode: status, error: `HTTP ${status}` };
    }
    return { isBroken: false, isRedirect: false, statusCode: status };
  }

  _isDomainDead(url) {
    try {
      const domain = new URL(url).hostname;
      const cached = this.domainCache.get(domain);
      if (cached && Date.now() - cached.ts < this.DOMAIN_CACHE_TTL) return cached.dead;
    } catch {}
    return null;
  }

  _markDomain(url, dead) {
    try {
      const domain = new URL(url).hostname;
      this.domainCache.set(domain, { dead, ts: Date.now() });
    } catch {}
  }

  /** Normalize URL for cache key: strip fragment; use hash if URL too long. */
  _linkCacheKey(url, activityId = null) {
    if (!url || typeof url !== "string") return null;
    let normalized = url.trim();
    try {
      const u = new URL(normalized);
      u.hash = "";
      normalized = u.href;
    } catch {
      return null;
    }
    const rawPrefix = this._cacheConfig.key_prefix || "lv:";
    const basePrefix =
      activityId != null ? `${rawPrefix}${String(activityId)}:` : rawPrefix;
    const maxLen = this._cacheConfig.max_key_length ?? 400;
    if (normalized.length <= maxLen) return basePrefix + normalized;
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    return basePrefix + "h:" + hash;
  }

  /** Get cached link status. Returns null on miss or error. */
  async _getLinkCache(url, activityId = null) {
    if (!this._redisGet || !this._cacheConfig.enabled) return null;
    const key = this._linkCacheKey(url, activityId);
    if (!key) return null;
    try {
      const raw = await this._redisGet(key);
      if (raw == null || raw === "") return null;
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.isBroken !== "boolean" ||
        typeof parsed.isRedirect !== "boolean"
      )
        return null;
      this.stats.linkCacheHits++;
      return parsed;
    } catch {
      this.stats.linkCacheMisses++;
      return null;
    }
  }

  /** Set cached link status under an activity-specific key (if activityId provided). */
  async _setLinkCache(url, result, activityId = null) {
    if (!this._redisSet || !this._cacheConfig.enabled || result == null)
      return;
    const key = this._linkCacheKey(url, activityId);
    if (!key) return;
    const ttl = Math.max(60, this._cacheConfig.ttl_seconds ?? 1800);
    const payload = JSON.stringify({
      isBroken: result.isBroken,
      isRedirect: result.isRedirect,
      statusCode: result.statusCode ?? 0,
      error: result.error ?? null,
      redirectTo: result.redirectTo ?? null,
    });
    try {
      await this._redisSet(key, payload, "EX", ttl);
      logger.info("Link cache set successfully");
    } catch (err) {
      logger.error("❌ Link cache set failed (non-fatal)", { err: err?.message });
    }
  }

  async checkLinkStatus(url, timeout, options = {}) {
    // Fast path: if we already know this domain is dead, do not waste more requests.
    // const cachedDead = this._isDomainDead(url);
    // if (cachedDead === true) {
    //   return {
    //     isBroken: true,
    //     isRedirect: false,
    //     statusCode: 0,
    //     error: "Domain previously unreachable (cached)",
    //   };
    // }

    // Redis cache: same URL validated once per TTL within an activity
    try {
      const activityId = options.activityId ?? null;
      const cached = await this._getLinkCache(url, activityId);
      if (cached) {
        logger.info("Link cache hit for URL:", url);
        return cached;
      }
    } catch {
      // Redis down or parse error: fall back to live check
    }
    if (this._cacheConfig.enabled && this._redisGet) this.stats.linkCacheMisses++;

    const activityId = options.activityId ?? null;
    const baseConfig = {
      timeout,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: DEFAULT_HEADERS,
    };

    try {
      const response = await axios.head(url, baseConfig);
      const parsed = this.parseResponse(response);
      // if (!parsed.isBroken && !parsed.isRedirect) {
      //   this._markDomain(url, false);
      // }
      await this._setLinkCache(url, parsed, activityId);
      return parsed;
    } catch {
      // HEAD not supported by server, fall back to GET
    }

    try {
      const response = await axios.get(url, {
        ...baseConfig,
        responseType: "stream",
      });
      response.data.destroy();
      const parsed = this.parseResponse(response);
      // if (!parsed.isBroken && !parsed.isRedirect) {
      //   this._markDomain(url, false);
      // }
      await this._setLinkCache(url, parsed, activityId);
      return parsed;
    } catch (err) {
      // this._markDomain(url, true);
      const parsed = {
        isBroken: true,
        isRedirect: false,
        statusCode: 0,
        error: err.code || err.message || "Connection failed",
      };
      await this._setLinkCache(url, parsed, activityId);
      return parsed;
    }
  }

  getLinkType(linkUrl, websiteUrl) {
    try {
      const linkDomain = new URL(linkUrl).hostname.replace(/^www\./, '');
      const websiteDomain = new URL(websiteUrl).hostname.replace(/^www\./, '');

      return linkDomain === websiteDomain ? "internal" : "external";
    } catch (error) {
      return "external";
    }
  }

  resolveUrl(linkUrl, baseUrl) {
    try {
      if (linkUrl.startsWith("http://") || linkUrl.startsWith("https://")) {
        return linkUrl;
      }

      const url = new URL(linkUrl, baseUrl);
      return url.href;
    } catch (error) {
      logger.debug(`Error resolving URL ${linkUrl}: ${error.message}`);
      return null;
    }
  }

  shouldSkipLink(url) {
    const skipProtocols = [
      "mailto:",
      "tel:",
      "javascript:",
      "data:",
      "ftp:",
    ];

    if (url === '#' || url.startsWith('#')) {
      return true;
    }

    return skipProtocols.some((protocol) => url.toLowerCase().startsWith(protocol));
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      ...this.stats,
      totalBrokenLinks:
        this.stats.internalBrokenLinksFound +
        this.stats.externalBrokenLinksFound,
    };
  }

  resetStats() {
    this.stats = {
      linksChecked: 0,
      internalBrokenLinksFound: 0,
      externalBrokenLinksFound: 0,
      redirectLinksFound: 0,
      errors: 0,
      linkCacheHits: 0,
      linkCacheMisses: 0,
    };
  }

  /**
   * Delete all link cache keys recorded for this activity. Call after crawl completes
   * so the next recrawl gets fresh validation (no stale broken-link cache).
   * Uses same key_prefix as config so activity keys live under same namespace as cache keys.
   * @param {object} redis - ioredis client
   * @param {string|object} activityId - activity id
   * @param {string} [keyPrefix] - optional key_prefix (e.g. from config.link_validation_cache.key_prefix); default "lv:"
   */
  static async clearActivityLinkCache(redis, activityId, keyPrefix) {
    if (!redis || activityId == null) return;
    try {
      const prefix = keyPrefix || "lv:";
      const pattern = `${prefix}${String(activityId)}:*`;
      const BATCH = 500;
      let cursor = "0";
      let totalDeleted = 0;

      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          BATCH,
        );
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== "0");

      if (totalDeleted > 0) {
        logger.info(
          `Cleared ${totalDeleted} link cache keys for activity ${activityId}`,
        );
      }
    } catch (err) {
      logger.warn("clearActivityLinkCache failed (non-fatal)", { activityId, err: err?.message });
    }
  }
}

module.exports = LinkProcessor;
