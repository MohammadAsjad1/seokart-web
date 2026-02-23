const UrlUtils = require('./url-utils');

class ValidationUtils {
  // URL validation
  static validateUrl(url) {
    const errors = [];
    
    if (!url) {
      errors.push('URL is required');
      return { isValid: false, errors };
    }
    
    if (typeof url !== 'string') {
      errors.push('URL must be a string');
      return { isValid: false, errors };
    }
    
    url = url.trim();
    
    if (url.length === 0) {
      errors.push('URL cannot be empty');
      return { isValid: false, errors };
    }
    
    if (url.length > 2048) {
      errors.push('URL is too long (max 2048 characters)');
    }
    
    if (!UrlUtils.isValidUrl(url)) {
      errors.push('Invalid URL format');
      return { isValid: false, errors };
    }
    
    // Check for localhost/private IPs in production
    if (process.env.NODE_ENV === 'production') {
      const domain = UrlUtils.extractDomain(url);
      if (this.isPrivateOrLocalDomain(domain)) {
        errors.push('Cannot access private or local domains in production');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      normalizedUrl: UrlUtils.normalizeUrl(url)
    };
  }
  
  // Check if domain is private/local
  static isPrivateOrLocalDomain(domain) {
    if (!domain) return false;
    
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
      /\.local$/i,
      /\.internal$/i
    ];
    
    return privatePatterns.some(pattern => pattern.test(domain));
  }
  
  
  // Sitemap URLs validation
  static validateSitemapUrls(sitemapUrls) {
    const errors = [];
    
    if (!Array.isArray(sitemapUrls)) {
      errors.push('Sitemap URLs must be an array');
      return { isValid: false, errors };
    }
    
    if (sitemapUrls.length === 0) {
      errors.push('At least one sitemap URL is required');
      return { isValid: false, errors };
    }
    
    if (sitemapUrls.length > 50) {
      errors.push('Too many sitemap URLs (max 50)');
    }
    
    const validUrls = [];
    const invalidUrls = [];
    
    sitemapUrls.forEach((url, index) => {
      const validation = this.validateUrl(url);
      if (validation.isValid) {
        validUrls.push(validation.normalizedUrl);
      } else {
        invalidUrls.push({ index, url, errors: validation.errors });
      }
    });
    
    if (invalidUrls.length > 0) {
      errors.push(`Invalid URLs found: ${invalidUrls.map(u => `#${u.index}`).join(', ')}`);
    }
    
    return {
      isValid: errors.length === 0 && validUrls.length > 0,
      errors,
      validUrls,
      invalidUrls
    };
  }
  
  // Processing options validation
  static validateProcessingOptions(options = {}) {
    const errors = [];
    const validOptions = {};
    
    // Validate concurrency settings
    if (options.concurrency !== undefined) {
      if (typeof options.concurrency !== 'object') {
        errors.push('Concurrency must be an object');
      } else {
        const { fast_scraper, slow_analyzer } = options.concurrency;
        
        if (fast_scraper !== undefined) {
          if (!Number.isInteger(fast_scraper) || fast_scraper < 1 || fast_scraper > 50) {
            errors.push('Fast scraper concurrency must be between 1 and 50');
          } else {
            validOptions.fast_scraper_concurrency = fast_scraper;
          }
        }
        
        if (slow_analyzer !== undefined) {
          if (!Number.isInteger(slow_analyzer) || slow_analyzer < 1 || slow_analyzer > 20) {
            errors.push('Slow analyzer concurrency must be between 1 and 20');
          } else {
            validOptions.slow_analyzer_concurrency = slow_analyzer;
          }
        }
      }
    }
    
    // Validate timeout settings
    if (options.timeouts !== undefined) {
      if (typeof options.timeouts !== 'object') {
        errors.push('Timeouts must be an object');
      } else {
        const { request, sitemap } = options.timeouts;
        
        if (request !== undefined) {
          if (!Number.isInteger(request) || request < 1000 || request > 60000) {
            errors.push('Request timeout must be between 1000ms and 60000ms');
          } else {
            validOptions.request_timeout = request;
          }
        }
        
        if (sitemap !== undefined) {
          if (!Number.isInteger(sitemap) || sitemap < 1000 || sitemap > 30000) {
            errors.push('Sitemap timeout must be between 1000ms and 30000ms');
          } else {
            validOptions.sitemap_timeout = sitemap;
          }
        }
      }
    }
    
    // Validate filters
    if (options.filters !== undefined) {
      if (typeof options.filters !== 'object') {
        errors.push('Filters must be an object');
      } else {
        const { includePatterns, excludePatterns } = options.filters;
        
        if (includePatterns !== undefined) {
          if (!Array.isArray(includePatterns)) {
            errors.push('Include patterns must be an array');
          } else {
            validOptions.include_patterns = includePatterns.filter(p => typeof p === 'string');
          }
        }
        
        if (excludePatterns !== undefined) {
          if (!Array.isArray(excludePatterns)) {
            errors.push('Exclude patterns must be an array');
          } else {
            validOptions.exclude_patterns = excludePatterns.filter(p => typeof p === 'string');
          }
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      validOptions
    };
  }
  
  // Sanitize HTML content
  static sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }
    
    // Remove script and style tags
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Remove HTML tags but keep content
    html = html.replace(/<[^>]*>/g, ' ');
    
    // Normalize whitespace
    html = html.replace(/\s+/g, ' ').trim();
    
    // Limit length
    if (html.length > 50000) {
      html = html.substring(0, 50000) + '...';
    }
    
    return html;
  }
  
  // Sanitize text input
  static sanitizeText(text, maxLength = 1000) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // Remove control characters except newlines and tabs
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    // Limit length
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
    }
    
    return text;
  }
  
  // Validate pagination parameters
  static validatePagination(page, limit) {
    const errors = [];
    
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    
    if (isNaN(page) || page < 1) {
      page = 1;
    }
    
    if (page > 1000) {
      errors.push('Page number too high (max 1000)');
      page = 1000;
    }
    
    if (isNaN(limit) || limit < 1) {
      limit = 20;
    }
    
    if (limit > 100) {
      errors.push('Limit too high (max 100)');
      limit = 100;
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      page,
      limit
    };
  }
  
  // Validate sort parameters
  static validateSort(sortBy, sortOrder, allowedFields = []) {
    const errors = [];
    
    if (sortBy && !allowedFields.includes(sortBy)) {
      errors.push(`Invalid sort field. Allowed: ${allowedFields.join(', ')}`);
      sortBy = allowedFields[0] || 'createdAt';
    }
    
    if (sortOrder && !['asc', 'desc'].includes(sortOrder.toLowerCase())) {
      errors.push('Sort order must be "asc" or "desc"');
      sortOrder = 'desc';
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sortBy: sortBy || 'createdAt',
      sortOrder: (sortOrder || 'desc').toLowerCase()
    };
  }
  
  // Check if string contains malicious patterns
  static containsMaliciousContent(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    
    const maliciousPatterns = [
      /<script/i,
      /javascript:/i,
      /data:text\/html/i,
      /vbscript:/i,
      /onload=/i,
      /onerror=/i,
      /onclick=/i,
      /eval\(/i,
      /document\.cookie/i,
      /window\.location/i
    ];
    
    return maliciousPatterns.some(pattern => pattern.test(text));
  }
  
  // Validate file upload (if needed)
  static validateFileUpload(file, allowedTypes = [], maxSize = 10485760) {
    const errors = [];
    
    if (!file) {
      errors.push('File is required');
      return { isValid: false, errors };
    }
    
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
      errors.push(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
    }
    
    if (file.size > maxSize) {
      errors.push(`File too large. Max size: ${Math.round(maxSize / 1024 / 1024)}MB`);
    }
    
    if (this.containsMaliciousContent(file.originalname)) {
      errors.push('Filename contains malicious content');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = ValidationUtils;