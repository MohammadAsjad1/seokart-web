const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const config = require("../config/scraper");
const logger = require("../config/logger");
const RateLimiter = require("./rate-limiter");
const { HttpsProxyAgent } = require("https-proxy-agent");

const RAW_PROXIES = [
  "142.111.48.253:7030:muxhrzvr:th23dyu55sh3",
  "31.59.20.176:6754:muxhrzvr:th23dyu55sh3",
  "38.170.176.177:5572:muxhrzvr:th23dyu55sh3",
  "198.23.239.134:6540:muxhrzvr:th23dyu55sh3",
  "45.38.107.97:6014:muxhrzvr:th23dyu55sh3",
  "107.172.163.27:6543:muxhrzvr:th23dyu55sh3",
  "64.137.96.74:6641:muxhrzvr:th23dyu55sh3",
  "216.10.27.159:6837:muxhrzvr:th23dyu55sh3",
  "142.111.67.146:5611:muxhrzvr:th23dyu55sh3",
  "142.147.128.93:6593:muxhrzvr:th23dyu55sh3",
];

const PROXIES = RAW_PROXIES.map((p) => {
  const [host, port, user, pass] = p.split(":");
  return `http://${user}:${pass}@${host}:${port}`;
});

class SequentialRotation {
  constructor(proxies, requestsPerProxy = 100) {
    this.proxies = proxies;
    this.agents = proxies.map(proxy => new HttpsProxyAgent(proxy, { 
      keepAlive: true,
      timeout: 30000 
    }));
    this.requestsPerProxy = requestsPerProxy;
    this.currentIndex = 0;
    this.requestCount = 0;
    this.blockedProxies = new Set();
    this.proxyStats = new Map();

    this.proxies.forEach((proxy, idx) => {
      this.proxyStats.set(idx, {
        successful: 0,
        failed: 0,
        blocked: false,
      });
    });

    this.fixedUserAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  }

  getBestProxy() {
    const available = [];
  
    this.proxyStats.forEach((stats, idx) => {
      if (!this.blockedProxies.has(idx)) {
        const total = stats.successful + stats.failed;
        const successRate = total === 0 ? 1 : stats.successful / total;
  
        available.push({
          idx,
          successRate,
        });
      }
    });
  
    if (available.length === 0) {
      this.blockedProxies.clear();
      return 0;
    }
  
    available.sort((a, b) => b.successRate - a.successRate);
  
    return available[0].idx;
  }

  // getNextProxy(skipCurrent = false) {
  //   if (skipCurrent || this.requestCount >= this.requestsPerProxy) {
  //     this.currentIndex = this.findNextAvailableProxy();
  //     this.requestCount = 0;
  //     console.log(
  //       `🔄 Switching to proxy ${this.currentIndex + 1}/${this.proxies.length}`
  //     );
  //   }

  //   this.requestCount++;
  //   return {
  //     proxy: this.proxies[this.currentIndex],
  //     agent: this.agents[this.currentIndex],
  //     proxyIndex: this.currentIndex,
  //     userAgent: this.fixedUserAgent,
  //     requestNum: this.requestCount,
  //   };
  // }
  getNextProxy(forceSwitch = false) {
    if (forceSwitch || this.requestCount >= this.requestsPerProxy) {
      this.currentIndex = this.getBestProxy();
      this.requestCount = 0;
    }
  
    this.requestCount++;
  
    return {
      proxy: this.proxies[this.currentIndex],
      agent: this.agents[this.currentIndex],
      proxyIndex: this.currentIndex,
      userAgent: this.fixedUserAgent,
    };
  }

  findNextAvailableProxy() {
    let attempts = 0;
    let nextIndex = (this.currentIndex + 1) % this.proxies.length;

    while (
      this.blockedProxies.has(nextIndex) &&
      attempts < this.proxies.length
    ) {
      nextIndex = (nextIndex + 1) % this.proxies.length;
      attempts++;
    }

    if (attempts >= this.proxies.length) {
      console.warn("⚠️ All proxies blocked! Resetting blocked list...");
      this.blockedProxies.clear();
      this.proxyStats.forEach((stats) => (stats.blocked = false));
      return 0;
    }

    return nextIndex;
  }

  markProxyAsBlocked(proxyIndex) {
    this.blockedProxies.add(proxyIndex);
    const stats = this.proxyStats.get(proxyIndex);
    if (stats) {
      stats.blocked = true;
    }
    // console.log(
    //   `🚫 Proxy ${proxyIndex + 1} marked as blocked. Blocked count: ${
    //     this.blockedProxies.size
    //   }`
    // );
    setTimeout(() => {
      this.blockedProxies.delete(proxyIndex);
    }, 5 * 60 * 1000);
    logger.error(`🚫 Proxy ${proxyIndex + 1} marked as blocked. Blocked count: ${this.blockedProxies.size}`);
  }

  recordSuccess(proxyIndex) {
    const stats = this.proxyStats.get(proxyIndex);
    if (stats) {
      stats.successful++;
    }
  }

  recordFailure(proxyIndex) {
    const stats = this.proxyStats.get(proxyIndex);
    if (stats) {
      stats.failed++;
    }
  }

  getStats() {
    const statsArray = Array.from(this.proxyStats.entries()).map(
      ([idx, stats]) => ({
        proxyNumber: idx + 1,
        ...stats,
      })
    );

    return {
      currentProxy: this.currentIndex + 1,
      totalProxies: this.proxies.length,
      requestsOnCurrent: this.requestCount,
      requestsPerProxy: this.requestsPerProxy,
      blockedProxies: this.blockedProxies.size,
      proxyStats: statsArray,
    };
  }
}

class WebScraper {
  constructor() {
    this.rateLimiter = new RateLimiter();
    this.sessions = new Map();
    this.stats = {
      requests_made: 0,
      successful_requests: 0,
      failed_requests: 0,
      retried_requests: 0,
      avg_response_time: 0,
      consecutive_failures: 0,
    };

    this.rotationHandler = new SequentialRotation(PROXIES, 100);
    this.shouldStop = false;
    this.MAX_CONSECUTIVE_FAILURES = 25;
    
    console.log("🎯 Sequential rotation initialized - 100 requests per proxy");
  }

  stopScraping() {
    this.shouldStop = true;
    console.log("🛑 Stop signal received - will finish current batch");
  }

  resetStopSignal() {
    this.shouldStop = false;
    this.stats.consecutive_failures = 0;
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return null;
    }
  }

  getRotationStats() {
    return this.rotationHandler.getStats();
  }

  async scrapeWebpage(url, options = {}) {
    // url -> https://www.google.com
    if (this.shouldStop) {
      throw new Error("Scraping stopped by user");
    }

    const maxRetries = options.maxRetries || 2;
    const timeout = options.timeout || 30000;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.shouldStop) {
        throw new Error("Scraping stopped by user");
      }

      const startTime = Date.now();
      this.stats.requests_made++;

      if (attempt > 0) {
        this.stats.retried_requests++;
        console.log(`🔁 Retry attempt ${attempt}/${maxRetries} for ${url}`);
      }

      const { proxy, agent, proxyIndex, userAgent } =
        this.rotationHandler.getNextProxy(attempt > 0);

      try {
        console.log(
          `🌐 Request #${this.stats.requests_made} to ${url} via proxy ${
            proxyIndex + 1
          }`
        );

        // const proxyAgent = new HttpsProxyAgent(proxy);

        const response = await axios.get(url, {
          timeout,
          responseType: "text",
          validateStatus: (status) => status < 500,
          maxContentLength: 10 * 1024 * 1024,
          httpsAgent: agent,
          httpAgent: agent,
          proxy: false,
          headers: {
            "User-Agent": userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            DNT: "1",
          },
        });
        if (response.status === 403 || response.status === 429) {
          throw new Error(
            `HTTP ${response.status}: Likely blocked or rate limited`
          );
        }

        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const responseTime = Date.now() - startTime;
        this.stats.successful_requests++;
        this.stats.consecutive_failures = 0;
        this.rotationHandler.recordSuccess(proxyIndex);

        console.log(
          `✅ Success! Response time: ${responseTime}ms via proxy ${
            proxyIndex + 1
          }`
        );

        const scraped_data = this.parseHtmlContent(
          response.data,
          url,
          response.status
        );
        scraped_data.response_time = responseTime;
        scraped_data.scraping_method = "nodejs_axios_proxy";
        scraped_data.proxy_used = proxyIndex + 1;
        scraped_data.attempt_number = attempt + 1;
        scraped_data.rawHtml = response.data;

        this.updateAverageResponseTime(responseTime);
        return scraped_data;
      } catch (err) {
        const responseTime = Date.now() - startTime;
        lastError = err;

        this.stats.consecutive_failures++;
        this.rotationHandler.recordFailure(proxyIndex);

        // const isBlocked =
        //   err.message.includes("403") ||
        //   err.message.includes("429") ||
        //   err.message.includes("ECONNREFUSED") ||
        //   err.message.includes("ETIMEDOUT");
        const isBlocked =
                    err.code === "ECONNREFUSED" ||
                    err.code === "ETIMEDOUT" ||
                    err.response?.status === 403 ||
                    err.response?.status === 429;

        if (isBlocked) {
          // console.error(
          //   `❌ Proxy ${proxyIndex + 1} likely blocked: ${err.message}`
          // );
          logger.error(`❌ Proxy ${proxyIndex + 1} likely blocked: ${err.message}`);
          this.rotationHandler.markProxyAsBlocked(proxyIndex);
        } else {
            // console.error(
            //   `❌ Request failed via proxy ${proxyIndex + 1}: ${err.message}`
            // );
            logger.error(`❌ Request failed via proxy ${proxyIndex + 1}: ${err.message}`);
        }

        if (this.stats.consecutive_failures >= this.MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `💥 Max consecutive failures (${this.MAX_CONSECUTIVE_FAILURES}) reached. Stopping scraper.`
          );
          this.shouldStop = true;
          throw new Error(
            `Rate limited: ${this.MAX_CONSECUTIVE_FAILURES} consecutive failures detected`
          );
        }

        if (attempt === maxRetries) {
          break;
        }

        await this.sleep(1000 * (attempt + 1));
      }
    }

    this.stats.failed_requests++;
    console.error(
      `💥 All attempts failed for ${url}. Last error: ${lastError.message}`
    );
    throw new Error(
      `Scraping failed after ${maxRetries + 1} attempts: ${lastError.message}`
    );
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateAverageResponseTime(responseTime) {
    const totalRequests = this.stats.successful_requests;
    this.stats.avg_response_time =
      (this.stats.avg_response_time * (totalRequests - 1) + responseTime) /
      totalRequests;
  }

  getScrapingStats() {
    return {
      ...this.stats,
      success_rate:
        this.stats.requests_made > 0
          ? (
              (this.stats.successful_requests / this.stats.requests_made) *
              100
            ).toFixed(2) + "%"
          : "0%",
      retry_rate:
        this.stats.requests_made > 0
          ? (
              (this.stats.retried_requests / this.stats.requests_made) *
              100
            ).toFixed(2) + "%"
          : "0%",
      rotation_stats: this.getRotationStats(),
      is_stopped: this.shouldStop,
      consecutive_failures: this.stats.consecutive_failures,
    };
  }

  parseHtmlContent(html, url, statusCode) {
    const $ = cheerio.load(html);
    const websiteUrl = this.extractWebsiteUrl(url);

    $(
      "script, style, noscript, nav, header, footer, aside, .advertisement, .ads, .social-share"
    ).remove();

    let title = $("title").text();
    title = this.cleanText(title);

    let metaDescription =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    metaDescription = this.cleanText(metaDescription);

    let content = this.extractMainContent($);
    content = this.cleanText(content);

    if (content.length > config.seo.max_content_length) {
      content = content.substring(0, config.seo.max_content_length) + "...";
    }

    const headings = this.extractHeadings($);
    const images = this.extractBasicImageInfo($);
    const links = this.extractDetailedLinkInfo($, url);
    const technical = this.extractBasicTechnicalInfo($);
    const wordCount = this.calculateWordCount(content);

    return {
      url,
      pageUrl: url,
      websiteUrl,
      statusCode,
      title,
      titleLength: title.length,
      metaDescription,
      metaDescriptionLength: metaDescription.length,
      content,
      wordCount,
      headingStructure: headings,
      images,
      links,
      technicalSeo: technical,
      scrapedAt: new Date().toISOString(),
      lastCrawled: new Date().toISOString(),
    };
  }

  cleanText(text) {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ")
      .replace(/\u00A0/g, " ")
      .replace(/[\u2000-\u200B]/g, " ")
      .replace(/\u00AD/g, "")
      .replace(/[\u200C\u200D]/g, "")
      .trim();
  }

  extractMainContent($) {
    let content = "";
    const contentSelectors = [
      "main",
      "article",
      '[role="main"]',
      ".main-content",
      ".content",
      "#content",
      ".post-content",
      ".entry-content",
      ".article-content",
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text.length > content.length) {
          content = text;
        }
      }
    }

    if (!content || content.length < 100) {
      $("nav, header, footer, aside, .sidebar, .menu, .navigation").remove();
      content = $("body").text().trim();
    }

    return content;
  }

  extractHeadings($) {
    const headings = {
      h1Count: $("h1").length,
      h2Count: $("h2").length,
      h3Count: $("h3").length,
      h4Count: $("h4").length,
      h5Count: $("h5").length,
      h6Count: $("h6").length,
      h1Text: this.cleanText($("h1").first().text()),
      h2Texts: $("h2")
        .map((i, el) => this.cleanText($(el).text()))
        .get()
        .slice(0, 5),
    };

    headings.h1Missing = headings.h1Count === 0;
    headings.h1Multiple = headings.h1Count > 1;

    return headings;
  }

  extractBasicImageInfo($) {
    const images = $("img");
    const totalCount = images.length;
    let withAlt = 0;
    let withTitle = 0;

    images.each((i, img) => {
      if ($(img).attr("alt") && $(img).attr("alt").trim()) withAlt++;
      if ($(img).attr("title") && $(img).attr("title").trim()) withTitle++;
    });

    return {
      totalCount,
      withAlt,
      withTitle,
      altMissingPercentage:
        totalCount > 0
          ? (((totalCount - withAlt) / totalCount) * 100).toFixed(1)
          : 0,
    };
  }

  extractDetailedLinkInfo($, currentUrl) {
    const links = $("a[href]");
    const totalCount = links.length;
    let internalCount = 0;
    let externalCount = 0;
    let httpLinksCount = 0;
    const allLinks = [];

    const currentDomain = this.extractDomain(currentUrl);

    links.each((i, link) => {
      const href = $(link).attr("href");
      const text = this.cleanText($(link).text());

      if (href) {
        try {
          const linkUrl = new URL(href, currentUrl);
          const isInternal = linkUrl.hostname === currentDomain;

          if (isInternal) {
            internalCount++;
          } else {
            externalCount++;
          }

          if (linkUrl.protocol === "http:") {
            httpLinksCount++;
          }

          allLinks.push({
            url: linkUrl.href,
            text: text || href,
            type: isInternal ? "internal" : "external",
            rel: $(link).attr("rel") || "",
          });
        } catch (e) {
        }
      }
    });

    return {
      totalCount,
      internalCount,
      externalCount,
      internalBrokenLinksCount: 0,
      externalBrokenLinksCount: 0,
      redirectLinksCount: 0,
      httpLinksCount,
      httpsLinksCount: totalCount - httpLinksCount,
      noFollowCount: $('a[rel*="nofollow"]').length,
      allLinks: allLinks.slice(0, 50),
    };
  }

  extractBasicTechnicalInfo($) {
    return {
      canonicalTagExists: $('link[rel="canonical"]').length > 0,
      canonicalUrl: $('link[rel="canonical"]').attr("href") || "",
      hasViewport: $('meta[name="viewport"]').length > 0,
      hasCharset:
        $("meta[charset]").length > 0 ||
        $('meta[http-equiv="content-type"]').length > 0,
      robotsDirectives: $('meta[name="robots"]').attr("content") || "",
      structuredData: $('script[type="application/ld+json"]').length > 0,
      hasH1: $("h1").length > 0,
      hasMetaDescription: $('meta[name="description"]').length > 0,
      responsiveChecks: {
        hasViewport:
          $('meta[name="viewport"]')
            .attr("content")
            ?.includes("width=device-width") || false,
        hasMediaQueries: $("style")
          .toArray()
          .some((el) => $(el).html().includes("@media")),
        hasResponsiveUnits: $("style")
          .toArray()
          .some((el) => /(vw|vh|%|em|rem|fr)/i.test($(el).html())),
      },
    };
  }

  extractWebsiteUrl(pageUrl) {
    try {
      const url = new URL(pageUrl);
      return `${url.protocol}//${url.hostname}`;
    } catch (e) {
      return pageUrl;
    }
  }

  calculateWordCount(content) {
    if (!content) return 0;
    return content.split(/\s+/).filter((word) => word.length > 0).length;
  }

  getStats() {
    return this.getScrapingStats();
  }

  cleanup() {
    this.sessions.clear();
    this.rateLimiter.cleanup();
  }
}

module.exports = WebScraper;