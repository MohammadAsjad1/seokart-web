// === DOMAIN UTILITIES ===

class DomainUtils {
  /**
   * Validate domain format
   * @param {string} domain - Domain to validate
   * @returns {object} - { isValid: boolean, error: string }
   */
  static validateDomain(domain) {
    if (!domain || typeof domain !== 'string') {
      return { isValid: false, error: 'Domain is required' };
    }

    // Remove protocol if present
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
    
    // Basic domain regex
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
    
    if (!domainRegex.test(cleanDomain)) {
      return { isValid: false, error: 'Invalid domain format' };
    }

    return { isValid: true, domain: cleanDomain.toLowerCase() };
  }

  /**
   * Extract domain from URL
   * @param {string} url - URL to extract domain from
   * @returns {string} - Extracted domain
   */
  static extractDomain(url) {
    if (!url) return '';
    
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, '').toLowerCase();
    } catch (error) {
      // If URL parsing fails, try regex
      const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
      return match ? match[1].toLowerCase() : '';
    }
  }

  /**
   * Check if domain is accessible
   * @param {string} domain - Domain to check
   * @returns {Promise<boolean>} - Whether domain is accessible
   */
  static async isDomainAccessible(domain) {
    try {
      const response = await fetch(`https://${domain}`, {
        method: 'HEAD',
        timeout: 5000
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get domain suggestions based on existing domains
   * @param {Array} existingDomains - Array of existing domains
   * @param {string} seed - Seed domain for suggestions
   * @returns {Array} - Array of suggested domains
   */
  static getDomainSuggestions(existingDomains, seed) {
    const suggestions = [];
    const baseDomain = seed.replace(/^www\./, '');
    
    // Common variations
    const variations = [
      `www.${baseDomain}`,
      `blog.${baseDomain}`,
      `shop.${baseDomain}`,
      `app.${baseDomain}`,
      `api.${baseDomain}`,
      `mobile.${baseDomain}`
    ];

    variations.forEach(variation => {
      if (!existingDomains.includes(variation)) {
        suggestions.push(variation);
      }
    });

    return suggestions;
  }
}

// === KEYWORD UTILITIES ===

class KeywordUtils {
  /**
   * Clean and validate keywords
   * @param {Array} keywords - Array of keywords
   * @returns {object} - { valid: Array, invalid: Array }
   */
  static validateKeywords(keywords) {
    const valid = [];
    const invalid = [];

    keywords.forEach(keyword => {
      const cleaned = this.cleanKeyword(keyword);
      
      if (this.isValidKeyword(cleaned)) {
        valid.push(cleaned);
      } else {
        invalid.push(keyword);
      }
    });

    return { valid, invalid };
  }

  /**
   * Clean keyword string
   * @param {string} keyword - Keyword to clean
   * @returns {string} - Cleaned keyword
   */
  static cleanKeyword(keyword) {
    if (!keyword || typeof keyword !== 'string') return '';
    
    return keyword
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
      .substring(0, 200); // Limit length
  }

  /**
   * Check if keyword is valid
   * @param {string} keyword - Keyword to validate
   * @returns {boolean} - Whether keyword is valid
   */
  static isValidKeyword(keyword) {
    if (!keyword || keyword.length < 2) return false;
    if (keyword.length > 200) return false;
    
    // Check if keyword contains only valid characters
    const validPattern = /^[a-zA-Z0-9\s\-]+$/;
    return validPattern.test(keyword);
  }

  /**
   * Generate keyword variations
   * @param {string} keyword - Base keyword
   * @returns {Array} - Array of keyword variations
   */
  static generateVariations(keyword) {
    const variations = [];
    const modifiers = [
      'best', 'top', 'cheap', 'affordable', 'premium', 'quality',
      'buy', 'online', 'near me', 'reviews', 'guide', 'tips',
      'how to', 'what is', 'why', 'when', 'where'
    ];

    // Add modifiers before keyword
    modifiers.forEach(modifier => {
      variations.push(`${modifier} ${keyword}`);
    });

    // Add modifiers after keyword
    const postModifiers = ['reviews', 'guide', 'tips', 'online', 'near me'];
    postModifiers.forEach(modifier => {
      variations.push(`${keyword} ${modifier}`);
    });

    return variations;
  }

  /**
   * Categorize keywords by intent
   * @param {Array} keywords - Array of keywords
   * @returns {object} - Keywords categorized by intent
   */
  static categorizeByIntent(keywords) {
    const categories = {
      informational: [],
      navigational: [],
      transactional: [],
      commercial: []
    };

    const patterns = {
      informational: [
        'how to', 'what is', 'why', 'when', 'where', 'guide', 'tutorial',
        'tips', 'learn', 'meaning', 'definition', 'explain'
      ],
      navigational: [
        'login', 'sign in', 'website', 'official', 'homepage', 'contact',
        'support', 'account', 'dashboard'
      ],
      transactional: [
        'buy', 'purchase', 'order', 'download', 'get', 'free', 'trial',
        'subscribe', 'register', 'book', 'reserve'
      ],
      commercial: [
        'best', 'top', 'review', 'compare', 'vs', 'price', 'cost',
        'cheap', 'affordable', 'deal', 'discount', 'coupon'
      ]
    };

    keywords.forEach(keyword => {
      const lowerKeyword = keyword.toLowerCase();
      let categorized = false;

      for (const [intent, words] of Object.entries(patterns)) {
        if (words.some(word => lowerKeyword.includes(word))) {
          categories[intent].push(keyword);
          categorized = true;
          break;
        }
      }

      if (!categorized) {
        categories.informational.push(keyword);
      }
    });

    return categories;
  }

  /**
   * Calculate keyword difficulty estimate
   * @param {string} keyword - Keyword to analyze
   * @returns {number} - Difficulty score (0-100)
   */
  static estimateDifficulty(keyword) {
    let difficulty = 30; // Base difficulty

    // Length-based difficulty
    if (keyword.length < 10) difficulty += 20;
    else if (keyword.length > 30) difficulty -= 10;

    // Word count-based difficulty
    const wordCount = keyword.split(' ').length;
    if (wordCount === 1) difficulty += 25;
    else if (wordCount > 3) difficulty -= 15;

    // Commercial intent increases difficulty
    const commercialWords = ['buy', 'best', 'top', 'cheap', 'price'];
    if (commercialWords.some(word => keyword.includes(word))) {
      difficulty += 15;
    }

    return Math.max(0, Math.min(100, difficulty));
  }
}

// === PLAN MANAGEMENT UTILITIES ===

class PlanUtils {
  /**
   * Get plan configuration
   * @param {string} planType - Plan type (daily, weekly, monthly)
   * @returns {object} - Plan configuration
   */
  static getPlanConfig(planType) {
    const plans = {
      daily: {
        name: 'Daily',
        keywords: 500,
        competitors: 50,
        domains: 10,
        refreshesPerDay: 100,
        pricePerMonth: 99,
        features: [
          'Daily ranking updates',
          'Up to 500 keywords',
          'Up to 50 competitors',
          'Up to 10 domains',
          '100 manual refreshes per day',
          'Advanced analytics',
          'Export functionality',
          'Priority support'
        ]
      },
      weekly: {
        name: 'Weekly',
        keywords: 200,
        competitors: 20,
        domains: 5,
        refreshesPerDay: 50,
        pricePerMonth: 49,
        features: [
          'Weekly ranking updates',
          'Up to 200 keywords',
          'Up to 20 competitors',
          'Up to 5 domains',
          '50 manual refreshes per day',
          'Basic analytics',
          'Export functionality',
          'Email support'
        ]
      },
      monthly: {
        name: 'Monthly',
        keywords: 100,
        competitors: 10,
        domains: 1,
        refreshesPerDay: 20,
        pricePerMonth: 19,
        features: [
          'Monthly ranking updates',
          'Up to 100 keywords',
          'Up to 10 competitors',
          '1 domain',
          '20 manual refreshes per day',
          'Basic analytics',
          'CSV export',
          'Email support'
        ]
      }
    };

    return plans[planType] || plans.weekly;
  }

  /**
   * Check if action is allowed for user's plan
   * @param {object} userProfile - User profile with plan and usage
   * @param {string} action - Action to check
   * @param {number} quantity - Quantity of action
   * @returns {object} - { allowed: boolean, message: string }
   */
  static checkPlanLimits(userProfile, action, quantity = 1) {
    const { plan, planLimits, usage } = userProfile;
    
    switch (action) {
      case 'add_keywords':
        if (usage.keywordCount + quantity > planLimits.keywords) {
          return {
            allowed: false,
            message: `Keyword limit exceeded. Your ${plan} plan allows ${planLimits.keywords} keywords.`
          };
        }
        break;
        
      case 'add_competitors':
        if (usage.competitorCount + quantity > planLimits.competitors) {
          return {
            allowed: false,
            message: `Competitor limit exceeded. Your ${plan} plan allows ${planLimits.competitors} competitors.`
          };
        }
        break;
        
      case 'add_domains':
        if (usage.domainsCount + quantity > planLimits.domains) {
          return {
            allowed: false,
            message: `Domain limit exceeded. Your ${plan} plan allows ${planLimits.domains} domains.`
          };
        }
        break;
        
      case 'refresh_rankings':
        if (usage.refreshesToday + quantity > planLimits.refreshesPerDay) {
          return {
            allowed: false,
            message: `Daily refresh limit exceeded. Your ${plan} plan allows ${planLimits.refreshesPerDay} refreshes per day.`
          };
        }
        break;
        
      default:
        return { allowed: true, message: 'Action allowed' };
    }

    return { allowed: true, message: 'Action allowed' };
  }

  /**
   * Get upgrade suggestions based on usage
   * @param {object} userProfile - User profile with plan and usage
   * @returns {Array} - Array of upgrade suggestions
   */
  static getUpgradeSuggestions(userProfile) {
    const { plan, planLimits, usage } = userProfile;
    const suggestions = [];

    // Check if user is approaching limits
    const keywordUsage = usage.keywordCount / planLimits.keywords;
    const competitorUsage = usage.competitorCount / planLimits.competitors;
    const domainUsage = usage.domainsCount / planLimits.domains;
    const refreshUsage = usage.refreshesToday / planLimits.refreshesPerDay;

    if (keywordUsage > 0.8) {
      suggestions.push({
        type: 'keywords',
        message: `You're using ${Math.round(keywordUsage * 100)}% of your keyword limit`,
        recommendation: 'Consider upgrading to track more keywords'
      });
    }

    if (competitorUsage > 0.8) {
      suggestions.push({
        type: 'competitors',
        message: `You're using ${Math.round(competitorUsage * 100)}% of your competitor limit`,
        recommendation: 'Upgrade to monitor more competitors'
      });
    }

    if (domainUsage > 0.8) {
      suggestions.push({
        type: 'domains',
        message: `You're using ${Math.round(domainUsage * 100)}% of your domain limit`,
        recommendation: 'Upgrade to track more domains'
      });
    }

    if (refreshUsage > 0.8) {
      suggestions.push({
        type: 'refreshes',
        message: `You're using ${Math.round(refreshUsage * 100)}% of your daily refresh limit`,
        recommendation: 'Upgrade for more manual refreshes'
      });
    }

    return suggestions;
  }
}

// === RANKING UTILITIES ===

class RankingUtils {
  /**
   * Calculate ranking trend
   * @param {number} currentPosition - Current ranking position
   * @param {number} previousPosition - Previous ranking position
   * @returns {object} - { trend: string, change: number, icon: string }
   */
  static calculateTrend(currentPosition, previousPosition) {
    if (!previousPosition) {
      return { trend: 'new', change: 0, icon: '🆕' };
    }

    if (!currentPosition) {
      return { trend: 'lost', change: 0, icon: '❌' };
    }

    const change = previousPosition - currentPosition;
    
    if (change > 0) {
      return { trend: 'up', change, icon: '📈' };
    } else if (change < 0) {
      return { trend: 'down', change: Math.abs(change), icon: '📉' };
    } else {
      return { trend: 'same', change: 0, icon: '➖' };
    }
  }

  /**
   * Calculate visibility score
   * @param {Array} rankings - Array of ranking objects
   * @returns {number} - Visibility score (0-100)
   */
  static calculateVisibilityScore(rankings) {
    if (!rankings || rankings.length === 0) return 0;

    const totalScore = rankings.reduce((sum, ranking) => {
      const position = ranking.position;
      if (!position || position > 100) return sum;

      // Higher score for better positions
      const positionScore = Math.max(0, 101 - position);
      return sum + positionScore;
    }, 0);

    return Math.round((totalScore / (rankings.length * 100)) * 100);
  }

  /**
   * Get ranking insights
   * @param {Array} currentRankings - Current rankings
   * @param {Array} previousRankings - Previous rankings
   * @returns {object} - Insights object
   */
  static getRankingInsights(currentRankings, previousRankings) {
    const insights = {
      totalKeywords: currentRankings.length,
      improvements: 0,
      declines: 0,
      newKeywords: 0,
      lostKeywords: 0,
      topPerformers: [],
      needsAttention: []
    };

    currentRankings.forEach(current => {
      const previous = previousRankings.find(p => p.keywordId === current.keywordId);
      
      if (!previous) {
        insights.newKeywords++;
        return;
      }

      const trend = this.calculateTrend(current.position, previous.position);
      
      if (trend.trend === 'up') {
        insights.improvements++;
        if (trend.change >= 10) {
          insights.topPerformers.push({
            keyword: current.keyword,
            improvement: trend.change,
            currentPosition: current.position
          });
        }
      } else if (trend.trend === 'down') {
        insights.declines++;
        if (trend.change >= 10) {
          insights.needsAttention.push({
            keyword: current.keyword,
            decline: trend.change,
            currentPosition: current.position
          });
        }
      }
    });

    // Check for lost keywords
    previousRankings.forEach(previous => {
      const current = currentRankings.find(c => c.keywordId === previous.keywordId);
      if (!current) {
        insights.lostKeywords++;
      }
    });

    return insights;
  }

  /**
   * Format position for display
   * @param {number} position - Ranking position
   * @returns {string} - Formatted position
   */
  static formatPosition(position) {
    if (!position || position > 100) return 'Not ranked';
    
    if (position <= 10) return `${position} (Page 1)`;
    if (position <= 20) return `${position} (Page 2)`;
    if (position <= 30) return `${position} (Page 3)`;
    
    const page = Math.ceil(position / 10);
    return `${position} (Page ${page})`;
  }
}

// === DATA EXPORT UTILITIES ===

class ExportUtils {
  /**
   * Convert data to CSV format
   * @param {Array} data - Data to convert
   * @param {Array} columns - Column definitions
   * @returns {string} - CSV string
   */
  static toCSV(data, columns) {
    const headers = columns.map(col => col.label).join(',');
    const rows = data.map(row => {
      return columns.map(col => {
        const value = row[col.key];
        // Escape quotes and wrap in quotes if contains comma
        const escaped = String(value || '').replace(/"/g, '""');
        return escaped.includes(',') ? `"${escaped}"` : escaped;
      }).join(',');
    });

    return [headers, ...rows].join('\n');
  }

  /**
   * Generate keyword export data
   * @param {Array} keywords - Keywords to export
   * @returns {object} - Export data with multiple formats
   */
  static prepareKeywordExport(keywords) {
    const columns = [
      { key: 'keyword', label: 'Keyword' },
      { key: 'targetDomain', label: 'Domain' },
      { key: 'position', label: 'Position' },
      { key: 'previousPosition', label: 'Previous Position' },
      { key: 'trend', label: 'Trend' },
      { key: 'searchVolume', label: 'Search Volume' },
      { key: 'difficulty', label: 'Difficulty' },
      { key: 'location', label: 'Location' },
      { key: 'device', label: 'Device' },
      { key: 'lastUpdated', label: 'Last Updated' }
    ];

    const exportData = keywords.map(keyword => ({
      keyword: keyword.keyword,
      targetDomain: keyword.targetDomain,
      position: keyword.currentRanking?.position || 'Not ranked',
      previousPosition: keyword.currentRanking?.previousPosition || 'N/A',
      trend: keyword.currentRanking?.trend || 'N/A',
      searchVolume: keyword.searchVolume || 0,
      difficulty: keyword.difficulty || 0,
      location: keyword.location,
      device: keyword.device,
      lastUpdated: keyword.currentRanking?.lastUpdated ? 
        new Date(keyword.currentRanking.lastUpdated).toLocaleDateString() : 'N/A'
    }));

    return {
      data: exportData,
      csv: this.toCSV(exportData, columns),
      json: JSON.stringify(exportData, null, 2)
    };
  }
}

// === VALIDATION UTILITIES ===

class ValidationUtils {
  /**
   * Validate API request data
   * @param {object} data - Data to validate
   * @param {object} schema - Validation schema
   * @returns {object} - { isValid: boolean, errors: Array }
   */
  static validate(data, schema) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      if (rules.required && (!value || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value && rules.type && typeof value !== rules.type) {
        errors.push(`${field} must be of type ${rules.type}`);
        continue;
      }

      if (value && rules.minLength && value.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
        continue;
      }

      if (value && rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
        continue;
      }

      if (value && rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${field} format is invalid`);
        continue;
      }

      if (value && rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
        continue;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Keyword validation schema
   */
  static get keywordSchema() {
    return {
      keyword: {
        required: true,
        type: 'string',
        minLength: 2,
        maxLength: 200,
        pattern: /^[a-zA-Z0-9\s\-]+$/
      },
      targetDomain: {
        required: true,
        type: 'string',
        pattern: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/
      },
      location: {
        required: false,
        type: 'string',
        maxLength: 100
      },
      device: {
        required: false,
        type: 'string',
        enum: ['desktop', 'mobile']
      }
    };
  }

  /**
   * Domain validation schema
   */
  static get domainSchema() {
    return {
      domain: {
        required: true,
        type: 'string',
        pattern: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/
      },
      name: {
        required: false,
        type: 'string',
        maxLength: 100
      }
    };
  }
}

module.exports = {
  DomainUtils,
  KeywordUtils,
  PlanUtils,
  RankingUtils,
  ExportUtils,
  ValidationUtils
};