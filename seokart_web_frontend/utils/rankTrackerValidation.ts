// utils/rankTrackerValidation.ts

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export class RankTrackerValidator {
  // Domain validation regex
  private static readonly DOMAIN_REGEX = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;

  /**
   * Validate keyword form data
   */
  static validateKeywordFormData(data: {
    keywords: string[];
    targetDomain: string;
    location: string;
    device: string;
    searchEngine: string;
    language: string;
  }): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate keywords
    if (!data.keywords || data.keywords.length === 0) {
      errors.push({
        field: 'keywords',
        message: 'At least one keyword is required'
      });
    }

    if (data.keywords) {
      data.keywords.forEach((keyword, index) => {
        if (!keyword || keyword.trim().length === 0) {
          errors.push({
            field: `keywords[${index}]`,
            message: `Keyword ${index + 1} cannot be empty`
          });
        }

        if (keyword && keyword.trim().length > 100) {
          errors.push({
            field: `keywords[${index}]`,
            message: `Keyword ${index + 1} is too long (max 100 characters)`
          });
        }
      });
    }

    // Validate target domain
    if (!data.targetDomain || data.targetDomain.trim().length === 0) {
      errors.push({
        field: 'targetDomain',
        message: 'Target domain is required'
      });
    } else if (!this.DOMAIN_REGEX.test(data.targetDomain.trim())) {
      errors.push({
        field: 'targetDomain',
        message: 'Invalid domain format'
      });
    }

    // Validate location
    if (!data.location || data.location.trim().length === 0) {
      errors.push({
        field: 'location',
        message: 'Location is required'
      });
    }

    // Validate device
    const validDevices = ['desktop', 'mobile'];
    if (!data.device || !validDevices.includes(data.device)) {
      errors.push({
        field: 'device',
        message: 'Device must be either desktop or mobile'
      });
    }

    // Validate search engine
    const validSearchEngines = ['google', 'bing', 'yahoo'];
    if (!data.searchEngine || !validSearchEngines.includes(data.searchEngine)) {
      errors.push({
        field: 'searchEngine',
        message: 'Search engine must be google, bing, or yahoo'
      });
    }

    // Validate language
    const validLanguages = ['en', 'hi', 'es'];
    if (!data.language || !validLanguages.includes(data.language)) {
      errors.push({
        field: 'language',
        message: 'Language must be en, hi, or es'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate competitor domains
   */
  static validateCompetitors(domains: string[]): ValidationResult {
    const errors: ValidationError[] = [];

    if (!domains || domains.length === 0) {
      errors.push({
        field: 'competitors',
        message: 'At least one competitor is required'
      });
      return { isValid: false, errors };
    }

    domains.forEach((domain, index) => {
      if (!domain || domain.trim().length === 0) {
        errors.push({
          field: `competitors[${index}]`,
          message: `Competitor ${index + 1} domain cannot be empty`
        });
        return;
      }

      if (!this.DOMAIN_REGEX.test(domain.trim())) {
        errors.push({
          field: `competitors[${index}]`,
          message: `Invalid domain format for competitor ${index + 1}: ${domain}`
        });
      }
    });

    // Check for duplicates
    const trimmedDomains = domains.map(d => d.trim().toLowerCase());
    const uniqueDomains = new Set(trimmedDomains);
    if (uniqueDomains.size !== trimmedDomains.length) {
      errors.push({
        field: 'competitors',
        message: 'Duplicate competitor domains are not allowed'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate single keyword
   */
  static validateKeyword(keyword: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!keyword || keyword.trim().length === 0) {
      errors.push({
        field: 'keyword',
        message: 'Keyword is required'
      });
    } else {
      if (keyword.trim().length > 100) {
        errors.push({
          field: 'keyword',
          message: 'Keyword is too long (max 100 characters)'
        });
      }

      if (keyword.trim().length < 2) {
        errors.push({
          field: 'keyword',
          message: 'Keyword is too short (min 2 characters)'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate domain format
   */
  static validateDomain(domain: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!domain || domain.trim().length === 0) {
      errors.push({
        field: 'domain',
        message: 'Domain is required'
      });
    } else if (!this.DOMAIN_REGEX.test(domain.trim())) {
      errors.push({
        field: 'domain',
        message: 'Invalid domain format'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate bulk keyword request
   */
  static validateBulkKeywords(keywords: Array<{
    keyword: string;
    targetDomain: string;
    location?: string;
    device?: string;
    searchEngine?: string;
    language?: string;
  }>): ValidationResult {
    const errors: ValidationError[] = [];

    if (!keywords || keywords.length === 0) {
      errors.push({
        field: 'keywords',
        message: 'At least one keyword is required'
      });
      return { isValid: false, errors };
    }

    if (keywords.length > 50) {
      errors.push({
        field: 'keywords',
        message: 'Maximum 50 keywords can be added at once'
      });
    }

    keywords.forEach((item, index) => {
      // Validate individual keyword
      const keywordValidation = this.validateKeyword(item.keyword);
      keywordValidation.errors.forEach(error => {
        errors.push({
          field: `keywords[${index}].${error.field}`,
          message: `Item ${index + 1}: ${error.message}`
        });
      });

      // Validate domain
      const domainValidation = this.validateDomain(item.targetDomain);
      domainValidation.errors.forEach(error => {
        errors.push({
          field: `keywords[${index}].${error.field}`,
          message: `Item ${index + 1}: ${error.message}`
        });
      });

      // Validate optional fields if provided
      if (item.device && !['desktop', 'mobile'].includes(item.device)) {
        errors.push({
          field: `keywords[${index}].device`,
          message: `Item ${index + 1}: Device must be either desktop or mobile`
        });
      }

      if (item.searchEngine && !['google', 'bing', 'yahoo'].includes(item.searchEngine)) {
        errors.push({
          field: `keywords[${index}].searchEngine`,
          message: `Item ${index + 1}: Search engine must be google, bing, or yahoo`
        });
      }

      if (item.language && !['en', 'hi', 'es'].includes(item.language)) {
        errors.push({
          field: `keywords[${index}].language`,
          message: `Item ${index + 1}: Language must be en, hi, or es`
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitize and clean input data
   */
  static sanitizeKeywordData(data: {
    keyword: string;
    targetDomain: string;
    location?: string;
    device?: string;
    searchEngine?: string;
    language?: string;
    tags?: string[];
  }) {
    return {
      keyword: data.keyword?.trim() || '',
      targetDomain: data.targetDomain?.toLowerCase().trim() || '',
      location: data.location?.trim() || 'United States',
      device: data.device?.toLowerCase().trim() || 'desktop',
      searchEngine: data.searchEngine?.toLowerCase().trim() || 'google',
      language: data.language?.toLowerCase().trim() || 'en',
      tags: data.tags?.map(tag => tag.trim()).filter(tag => tag.length > 0) || []
    };
  }

  /**
   * Sanitize competitor data
   */
  static sanitizeCompetitorData(data: {
    domain: string;
    name?: string;
  }) {
    return {
      domain: data.domain?.toLowerCase().trim() || '',
      name: data.name?.trim() || data.domain?.trim() || ''
    };
  }
}