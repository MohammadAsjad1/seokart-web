const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const logger = require("../config/logger");
const pLimit = require("p-limit").default;

class LinkProcessor {
  constructor() {
    this.stats = {
      linksChecked: 0,
      internalBrokenLinksFound: 0,
      externalBrokenLinksFound: 0,
      redirectLinksFound: 0,
      errors: 0,
    };
    this.timeout = 5000;
    this.maxRedirects = 5;
    this.domainCache = new Map();
    this.DOMAIN_CACHE_TTL = 60000;
  }

  async validatePageLinks(webpage) {
    try {
      const pageUrl = webpage.pageUrl || webpage.url;
      const websiteUrl = webpage.websiteUrl;
      
      logger.info(`🔍 Starting link validation for: ${pageUrl}`);
      // console.time("extractLinksFromWebpage");
      const links = await this.extractLinksFromWebpage(webpage, pageUrl);
      // console.timeEnd("extractLinksFromWebpage");
      if (!links || links.length === 0) {
        logger.warn(`⚠️  No links found on: ${pageUrl}`);
        return {
          internalBrokenLinks: [],
          externalBrokenLinks: [],
          redirectLinks: [],
        };
      }

      logger.info(`📊 Found ${links.length} unique links to validate on: ${pageUrl}`);
      // console.time("validateLinksWithRateLimit");
      const results = await this.validateLinksWithRateLimit(
        links,
        pageUrl,
        websiteUrl
      );
      // console.timeEnd("validateLinksWithRateLimit");
      logger.info(
        `✅ Link validation complete for ${pageUrl}:\n` +
        `   - ${results.internalBrokenLinks.length} internal broken\n` +
        `   - ${results.externalBrokenLinks.length} external broken\n` +
        `   - ${results.redirectLinks.length} redirects`
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
    const internalBrokenLinks = [];
    const externalBrokenLinks = [];
    const redirectLinks = [];

    const limit = pLimit(20); // increase to 20

    await Promise.all(
      links.map(link =>
        limit(async () => {
          const result = await this.validateLink(link, pageUrl, websiteUrl);
          if (!result) return;

          if (result.isRedirect) {
            redirectLinks.push(result);
          } else if (result.isBroken) {
            if (result.type === "internal") {
              internalBrokenLinks.push(result);
            } else {
              externalBrokenLinks.push(result);
            }
          }
        })
      )
    );


    logger.info(
      `📈 Validation complete: ` +
      `${internalBrokenLinks.length} internal broken, ` +
      `${externalBrokenLinks.length} external broken, ` +
      `${redirectLinks.length} redirects`
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
      const linkStatus = await this.checkLinkStatus(absoluteUrl);

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

  _parseResponse(response) {
    const status = response.status;
    if (status === 301 || status === 302 || status === 307 || status === 308) {
      return {
        isBroken: false,
        isRedirect: true,
        statusCode: status,
        redirectTo: response.headers.location || "",
      };
    }
    if (status >= 400) {
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

  async checkLinkStatus(url) {
    const domainDead = this._isDomainDead(url);
    if (domainDead === true) {
      return { isBroken: true, isRedirect: false, statusCode: 0, error: "Domain unreachable (cached)" };
    }

    const reqOpts = {
      timeout: 3000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    };

    try {
      const res = await axios.head(url, reqOpts);
      this._markDomain(url, false);
      if (res.status === 405 || res.status === 501) {
        const getRes = await axios.get(url, { ...reqOpts, maxContentLength: 0 });
        return this._parseResponse(getRes);
      }
      return this._parseResponse(res);
    } catch (headErr) {
      try {
        const getRes = await axios.get(url, { ...reqOpts, maxContentLength: 0 });
        this._markDomain(url, false);
        return this._parseResponse(getRes);
      } catch (getErr) {
        const code = getErr.code || headErr.code || "";
        if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
          this._markDomain(url, true);
        }
        return { isBroken: true, isRedirect: false, statusCode: 0, error: code || "Connection failed" };
      }
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
