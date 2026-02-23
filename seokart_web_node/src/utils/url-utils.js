const { URL } = require("url");

class UrlUtils {
  static ensureValidUrlFormat(url) {
    if (typeof url !== "string") return "";
    url = url.trim();

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return `https://${url}`;
  }
  static isValidUrl(url) {
    try {
      const hasProtocol =
        url.startsWith("http://") || url.startsWith("https://");
      const parsed = new URL(hasProtocol ? url : `https://${url}`);
      return parsed.hostname !== "";
    } catch {
      return false;
    }
  }

  static extractDomain(url) {
    try {
      const hasProtocol =
        url.startsWith("http://") || url.startsWith("https://");
      const finalUrl = hasProtocol ? url : `https://${url}`;
      return new URL(finalUrl).hostname;
    } catch {
      return null;
    }
  }

  static extractWebsiteUrl(pageUrl) {
    try {
      const formatted = this.ensureValidUrlFormat(pageUrl);
      const parsed = new URL(formatted);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      return pageUrl;
    }
  }

  static ensureValidUrlFormat(url) {
    if (typeof url !== "string") return "";

    url = url.trim();

    if (/^https?:\/\//i.test(url)) {
      // Normalize protocol casing
      const [protocol, rest] = url.split("://");
      return `${protocol.toLowerCase()}://${rest}`;
    }

    return `https://${url}`;
  }

  static normalizeUrl(url) {
    try {
      const formatted = this.ensureValidUrlFormat(url); 
      const parsed = new URL(formatted); // Parse the URL into components

      // Remove trailing slash from pathname (but not for root "/")
      if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      // Sort query parameters
      const params = new URLSearchParams(parsed.search);
      const sortedParams = new URLSearchParams();

      [...params.keys()].sort().forEach((key) => {
        params.getAll(key).forEach((value) => {
          sortedParams.append(key, value);
        });
      });

      parsed.search = sortedParams.toString(); // Apply sorted query parameters

      return parsed.href; // Return the fully normalized URL
    } catch {
      return url; // If parsing fails, return the original input
    }
  }

  static resolveUrl(url, baseUrl) {
    try {
      const formattedBase = this.ensureValidUrlFormat(baseUrl);
      return new URL(url, formattedBase).href;
    } catch {
      return url;
    }
  }

  static getUrlPath(url) {
    try {
      const formatted = this.ensureValidUrlFormat(url);
      return new URL(formatted).pathname;
    } catch {
      return "";
    }
  }

  static getUrlQuery(url) {
    try {
      const formatted = this.ensureValidUrlFormat(url);
      return new URL(formatted).search;
    } catch {
      return "";
    }
  }

  static isInternalUrl(url, baseUrl) {
    try {
      const formattedUrl = this.ensureValidUrlFormat(url);
      const formattedBase = this.ensureValidUrlFormat(baseUrl);
      const urlDomain = new URL(formattedUrl).hostname;
      const baseDomain = new URL(formattedBase).hostname;
      return urlDomain === baseDomain;
    } catch {
      return false;
    }
  }

  static isSocialMediaUrl(url) {
    const socialDomains = [
      "facebook.com",
      "twitter.com",
      "linkedin.com",
      "instagram.com",
      "youtube.com",
      "pinterest.com",
      "tiktok.com",
      "snapchat.com",
    ];

    try {
      const domain = new URL(url).hostname.toLowerCase();
      return socialDomains.some((social) => domain.includes(social));
    } catch {
      return false;
    }
  }

  static getFileExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const lastDot = pathname.lastIndexOf(".");
      return lastDot > 0 ? pathname.substring(lastDot + 1).toLowerCase() : "";
    } catch {
      return "";
    }
  }

  static isImageUrl(url) {
    const imageExtensions = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "svg",
      "bmp",
      "ico",
    ];
    const extension = this.getFileExtension(url);
    return imageExtensions.includes(extension);
  }

  static isDocumentUrl(url) {
    const docExtensions = [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "txt",
    ];
    const extension = this.getFileExtension(url);
    return docExtensions.includes(extension);
  }

  static sanitizeUrl(url) {
    if (!url || typeof url !== "string") {
      return "";
    }

    // Remove common tracking parameters
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
      "_ga",
      "mc_eid",
    ];

    try {
      const parsed = new URL(url);
      trackingParams.forEach((param) => {
        parsed.searchParams.delete(param);
      });

      return parsed.href;
    } catch {
      return url;
    }
  }

  static getUrlDepth(url) {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split("/").filter((segment) => segment.length > 0).length;
    } catch {
      return 0;
    }
  }

  static isSecureUrl(url) {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }

  static buildUrl(baseUrl, path, queryParams = {}) {
    try {
      const url = new URL(path, baseUrl);

      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });

      return url.href;
    } catch {
      return baseUrl;
    }
  }

  static extractUrlsFromText(text) {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const matches = text.match(urlRegex) || [];

    return matches
      .map((url) => url.replace(/[.,;:]$/, "")) // Remove trailing punctuation
      .filter((url) => this.isValidUrl(url));
  }

  static compareUrls(url1, url2) {
    try {
      const normalized1 = this.normalizeUrl(url1);
      const normalized2 = this.normalizeUrl(url2);
      return normalized1 === normalized2;
    } catch {
      return url1 === url2;
    }
  }
}

module.exports = UrlUtils;
