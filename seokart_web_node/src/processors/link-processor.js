const axios = require("axios");
const cheerio = require("cheerio");
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
  constructor() {
    this.stats = {
      linksChecked: 0,
      internalBrokenLinksFound: 0,
      externalBrokenLinksFound: 0,
      redirectLinksFound: 0,
      errors: 0,
    };
    this.timeout = config.timeouts?.link_check ?? 3000;
    this.maxRedirects = 5;
    this.domainCache = new Map();
    this.DOMAIN_CACHE_TTL = 60000;
  }

  async validatePageLinks(webpage) {
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
        websiteUrl
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

      // Clean up and remove duplicates
      const uniqueLinks = [];
      const seenUrls = new Set();

      for (const link of links) {
        const url = link.url || link.href;
        if (!url) continue;

        if (this.shouldSkipLink(url)) {
          continue;
        }

        const resolvedUrl = this.resolveUrl(url, pageUrl);
        if (!resolvedUrl) continue;

        if (!seenUrls.has(resolvedUrl)) {
          seenUrls.add(resolvedUrl);
          uniqueLinks.push({
            url: resolvedUrl,
            href: resolvedUrl,
            text: link.text || url
          });
        }
      }

      logger.info(`✨ Returning ${uniqueLinks.length} unique valid links for validation`);
      return uniqueLinks;

    } catch (error) {
      logger.error("❌ Error extracting links from webpage:", error);
      return [];
    }
  }

  async validateLinksWithRateLimit(links, pageUrl, websiteUrl) {
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
            const result = await this.validateLink(link, pageUrl, websiteUrl);
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

  async validateLink(link, pageUrl, websiteUrl) {
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
      const linkStatus = await this.checkLinkStatus(absoluteUrl, this.timeout);

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

  async checkLinkStatus(url, timeout) {
    // Fast path: if we already know this domain is dead, do not waste more requests.
    const cachedDead = this._isDomainDead(url);
    if (cachedDead === true) {
      return {
        isBroken: true,
        isRedirect: false,
        statusCode: 0,
        error: "Domain previously unreachable (cached)",
      };
    }

    const baseConfig = {
      timeout,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: DEFAULT_HEADERS,
    };
  
    try {
      const response = await axios.head(url, baseConfig);
      const parsed = this.parseResponse(response);
      // Only mark as alive on a non-error, non-redirect response
      if (!parsed.isBroken && !parsed.isRedirect) {
        this._markDomain(url, false);
      }
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
      if (!parsed.isBroken && !parsed.isRedirect) {
        this._markDomain(url, false);
      }
      return parsed;
    } catch (err) {
      // Treat repeated connection-level failures as a dead domain for a short TTL window
      this._markDomain(url, true);
      return {
        isBroken: true,
        isRedirect: false,
        statusCode: 0,
        error: err.code || err.message || "Connection failed",
      };
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
    };
  }
}

module.exports = LinkProcessor;
