const crypto = require('crypto');
const logger = require('../config/logger');
const { WebpageCore } = require('../models/webpage-models');

class DuplicateProcessor {
  constructor() {
    this.stats = {
      webpagesAnalyzed: 0,
      titleDuplicatesFound: 0,
      descriptionDuplicatesFound: 0,
      contentDuplicatesFound: 0
    };
  }

  async findDuplicates(currentWebpages, userId, websiteUrl) {
    try {
      this.stats.webpagesAnalyzed += currentWebpages.length;

      // Get ALL webpages for this website from database (not just current batch)
      const allWebpages = await WebpageCore.find({
        userId,
        websiteUrl,
        $or: [
          { title: { $exists: true, $ne: '', $ne: null } },
          { metaDescription: { $exists: true, $ne: '', $ne: null } },
          { content: { $exists: true, $ne: '', $ne: null } }
        ]
      }).select('_id pageUrl title metaDescription content wordCount').lean();

      logger.info(`Analyzing ${currentWebpages.length} pages against ${allWebpages.length} total pages for duplicates`, userId);

      if (allWebpages.length < 2) {
        return new Map(); // No duplicates possible with less than 2 pages
      }

      const duplicateResults = new Map();

      // Process each webpage in current batch against ALL website pages
      for (const currentPage of currentWebpages) {
        const duplicates = {
          titleDuplicates: [],
          descriptionDuplicates: [],
          contentDuplicates: []
        };

        // Find title duplicates - be more aggressive
        if (currentPage.title && currentPage.title.trim().length > 5) {
          duplicates.titleDuplicates = this.findTitleDuplicatesAgainstAll(
            currentPage,
            allWebpages
          );
          if (duplicates.titleDuplicates.length > 0) {
            this.stats.titleDuplicatesFound += duplicates.titleDuplicates.length;
            logger.debug(`Found ${duplicates.titleDuplicates.length} title duplicates for ${currentPage.pageUrl}`, userId);
          }
        }

        // Find meta description duplicates - be more aggressive
        if (currentPage.metaDescription && currentPage.metaDescription.trim().length > 10) {
          duplicates.descriptionDuplicates = this.findDescriptionDuplicatesAgainstAll(
            currentPage,
            allWebpages
          );
          if (duplicates.descriptionDuplicates.length > 0) {
            this.stats.descriptionDuplicatesFound += duplicates.descriptionDuplicates.length;
            logger.debug(`Found ${duplicates.descriptionDuplicates.length} description duplicates for ${currentPage.pageUrl}`, userId);
          }
        }

        // Find content duplicates - be more aggressive
        if (currentPage.content && currentPage.content.trim().length > 100) {
          duplicates.contentDuplicates = this.findContentDuplicatesAgainstAll(
            currentPage,
            allWebpages
          );
          if (duplicates.contentDuplicates.length > 0) {
            this.stats.contentDuplicatesFound += duplicates.contentDuplicates.length;
            logger.debug(`Found ${duplicates.contentDuplicates.length} content duplicates for ${currentPage.pageUrl}`, userId);
          }
        }

        duplicateResults.set(currentPage._id.toString(), duplicates);
      }

      logger.info(`Duplicate analysis completed: ${this.stats.titleDuplicatesFound} title, ${this.stats.descriptionDuplicatesFound} description, ${this.stats.contentDuplicatesFound} content duplicates found`, userId);

      return duplicateResults;

    } catch (error) {
      logger.error('Error finding duplicates', error, userId);
      return new Map();
    }
  }

  findTitleDuplicatesAgainstAll(currentPage, allWebpages) {
    const duplicates = [];
    const currentTitle = this.normalizeTitle(currentPage.title);
    
    if (!currentTitle || currentTitle.length < 5) {
      return duplicates;
    }

    for (const webpage of allWebpages) {
      // Skip self-comparison
      if (webpage._id.toString() === currentPage._id.toString()) {
        continue;
      }

      if (!webpage.title || !webpage.title.trim()) {
        continue;
      }

      const compareTitle = this.normalizeTitle(webpage.title);
      
      // Exact match
      if (currentTitle === compareTitle) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          title: webpage.title,
          duplicateType: 'exact_match',
          similarity: 1.0
        });
        continue;
      }

      // High similarity match (70%+ instead of 85%+ to find more duplicates)
      const similarity = this.calculateTextSimilarity(currentTitle, compareTitle);
      if (similarity >= 0.70) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          title: webpage.title,
          duplicateType: similarity >= 0.90 ? 'near_exact' : 'high_similarity',
          similarity: Math.round(similarity * 100) / 100
        });
      }

      // Check for common title patterns that indicate duplicates
      if (this.hasCommonTitlePattern(currentTitle, compareTitle)) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          title: webpage.title,
          duplicateType: 'pattern_match',
          similarity: 0.8
        });
      }
    }

    return duplicates;
  }

  findDescriptionDuplicatesAgainstAll(currentPage, allWebpages) {
    const duplicates = [];
    const currentDesc = this.normalizeDescription(currentPage.metaDescription);
    
    if (!currentDesc || currentDesc.length < 20) {
      return duplicates;
    }

    for (const webpage of allWebpages) {
      if (webpage._id.toString() === currentPage._id.toString()) {
        continue;
      }

      if (!webpage.metaDescription || !webpage.metaDescription.trim()) {
        continue;
      }

      const compareDesc = this.normalizeDescription(webpage.metaDescription);
      
      // Exact match
      if (currentDesc === compareDesc) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          description: webpage.metaDescription,
          duplicateType: 'exact_match',
          similarity: 1.0
        });
        continue;
      }

      // High similarity match (60%+ instead of 80% to find more duplicates)
      const similarity = this.calculateTextSimilarity(currentDesc, compareDesc);
      if (similarity >= 0.60) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          description: webpage.metaDescription,
          duplicateType: similarity >= 0.85 ? 'near_exact' : 'high_similarity',
          similarity: Math.round(similarity * 100) / 100
        });
      }
    }

    return duplicates;
  }

  findContentDuplicatesAgainstAll(currentPage, allWebpages) {
    const duplicates = [];
    const currentContent = this.normalizeContent(currentPage.content);
    
    if (!currentContent || currentContent.length < 200) {
      return duplicates;
    }

    const currentFingerprint = this.createContentFingerprint(currentContent);

    for (const webpage of allWebpages) {
      if (webpage._id.toString() === currentPage._id.toString()) {
        continue;
      }

      if (!webpage.content || !webpage.content.trim()) {
        continue;
      }

      const compareContent = this.normalizeContent(webpage.content);
      const compareFingerprint = this.createContentFingerprint(compareContent);

      // Quick fingerprint check first
      if (currentFingerprint === compareFingerprint) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          wordCount: webpage.wordCount || 0,
          duplicateType: 'exact_match',
          similarity: 1.0
        });
        continue;
      }

      // Detailed similarity check for potential matches (50%+ instead of 75%)
      const similarity = this.calculateContentSimilarity(currentContent, compareContent);
      
      if (similarity >= 0.50) {
        duplicates.push({
          pageUrl: webpage.pageUrl,
          wordCount: webpage.wordCount || 0,
          duplicateType: similarity >= 0.85 ? 'near_exact' : 'high_similarity',
          similarity: Math.round(similarity * 100) / 100
        });
      }
    }

    return duplicates;
  }

  hasCommonTitlePattern(title1, title2) {
    // Check for common patterns that indicate similar pages
    const patterns = [
      // Same page type patterns
      /^(home|about|contact|services|products|blog)/,
      // Category patterns
      /category|tag|archive/,
      // Page number patterns
      /page\s*\d+/,
      // Article patterns  
      /^article|^post|^news/
    ];

    for (const pattern of patterns) {
      if (pattern.test(title1) && pattern.test(title2)) {
        // Check if the rest of the title is similar
        const cleaned1 = title1.replace(pattern, '').trim();
        const cleaned2 = title2.replace(pattern, '').trim();
        if (cleaned1.length > 3 && cleaned2.length > 3) {
          const similarity = this.calculateTextSimilarity(cleaned1, cleaned2);
          if (similarity > 0.6) {
            return true;
          }
        }
      }
    }

    return false;
  }

  normalizeTitle(title) {
    if (!title) return '';
    
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-]/g, '')
      .substring(0, 200);
  }

  normalizeDescription(description) {
    if (!description) return '';
    
    return description
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-]/g, '')
      .substring(0, 300);
  }

  normalizeContent(content) {
    if (!content) return '';
    
    return content
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  createContentFingerprint(content) {
    const normalized = this.normalizeContent(content);
    const words = normalized.split(' ').filter(word => word.length > 3);
    
    // Use first 50 significant words for fingerprinting
    const significantWords = words.slice(0, 50).join(' ');
    
    return crypto.createHash('md5').update(significantWords).digest('hex');
  }

  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const words1 = text1.split(' ').filter(word => word.length > 2);
    const words2 = text2.split(' ').filter(word => word.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(word => set2.has(word)));
    const union = new Set([...set1, ...set2]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Also consider sequence similarity (Levenshtein-based)
    const sequenceSimilarity = this.calculateSequenceSimilarity(text1, text2);
    
    // Weighted combination
    return (jaccardSimilarity * 0.7) + (sequenceSimilarity * 0.3);
  }

  calculateContentSimilarity(content1, content2) {
    const words1 = this.extractSignificantWords(content1);
    const words2 = this.extractSignificantWords(content2);
    
    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(word => set2.has(word)));
    const union = new Set([...set1, ...set2]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Consider length similarity
    const lengthDiff = Math.abs(content1.length - content2.length);
    const maxLength = Math.max(content1.length, content2.length);
    const lengthSimilarity = 1 - (lengthDiff / maxLength);
    
    // Consider word count similarity
    const wordCountSimilarity = 1 - Math.abs(words1.length - words2.length) / Math.max(words1.length, words2.length);
    
    // Weighted combination
    return (jaccardSimilarity * 0.6) + (lengthSimilarity * 0.2) + (wordCountSimilarity * 0.2);
  }

  calculateSequenceSimilarity(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Quick optimization for very different lengths
    if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.7) {
      return 0;
    }

    // Limit string length for performance
    let maxLen = 500;
    const s1 = str1.length > maxLen ? str1.substring(0, maxLen) : str1;
    const s2 = str2.length > maxLen ? str2.substring(0, maxLen) : str2;

    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1.charAt(i - 1) === s2.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    const distance = matrix[s1.length][s2.length];
    maxLen = Math.max(s1.length, s2.length);
    
    return 1 - (distance / maxLen);
  }

  extractSignificantWords(content) {
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length >= 3 && 
        !this.isStopWord(word) && 
        !/^\d+$/.test(word)
      );

    // Get word frequency and return most common words
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    return Object.keys(wordFreq)
      .sort((a, b) => wordFreq[b] - wordFreq[a])
      .slice(0, 100);
  }

  isStopWord(word) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
      'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
    ]);
    
    return stopWords.has(word);
  }

  getStats() {
    return {
      ...this.stats,
      avgDuplicatesPerPage: this.stats.webpagesAnalyzed > 0 ? 
        ((this.stats.titleDuplicatesFound + this.stats.descriptionDuplicatesFound + this.stats.contentDuplicatesFound) / this.stats.webpagesAnalyzed).toFixed(2) : 0
    };
  }
}

module.exports = DuplicateProcessor;