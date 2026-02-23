const logger = require("../config/logger");
const spellChecker = require("simple-spellchecker");

class SpellingChecker {
  constructor() {
    this.dictionary = null;
    this.isInitialized = false;
    this.initializationPromise = null;

    // Words to ignore (common technical terms, brand names, etc.)
    this.ignoreWords = new Set([
     "seo",
      "html",
      "css",
      "javascript",
      "js",
      "api",
      "url",
      "urls",
      "http",
      "https",
      "www",
      "email",
      "webpage",
      "website",
      "cdn",
      "json",
      "xml",
      "svg",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "pdf",
      "app",
      "backend",
      "frontend",
      "ui",
      "ux",
      "shopify",
      "wordpress",
      "woocommerce",
      "bigcommerce",
      "magento",
      "drupal",
      "joomla",
      "wix",
      "squarespace",
      "weebly",
      "tumblr",
      "blogspot",
      "bitly",
      "tiktok",
      "instagram",
      "facebook",
      "twitter",
      "linkedin",
      "youtube",
      "pinterest",
      "snapchat",
      "whatsapp",
      "telegram",
      "slack",
      "zoom",
      "skype",
      "dropbox",
      "evernote",
      "asana",
      "trello",
      "notion",
      "github",
      "gitlab",
      "bitbucket",
      "docker",
      "kubernetes",
      "aws",
      "azure",
      "gcp",
      "seokart",
      "chatgpt",
      "gpt-4",
      "bard",
      "google",
      "bing",
      "yahoo",
      "duckduckgo",
      "ahrefs",
      "semrush",
      "moz",
      "majestic",
      "serpstat",
      "serp",
      "blog",
      "checkout",
      "apps",
      "plugins",
      "extensions",
      "backlinks",
      "keywords",
      "metatags",
      "backlink",
      "canonical",
    ]);

    this.stats = {
      textsChecked: 0,
      spellingErrorsFound: 0,
      totalIssuesFound: 0,
    };

    // Initialize dictionary on construction
    this.initializeDictionary();
  }

  async initializeDictionary() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = new Promise((resolve, reject) => {
      // Load English dictionary (US English)
      spellChecker.getDictionary("en-US", (err, result) => {
        if (err) {
          logger.error("Failed to load spell checker dictionary", err);
          reject(err);
          return;
        }

        this.dictionary = result;
        this.isInitialized = true;
        logger.info("Spell checker dictionary loaded successfully");
        resolve();
      });
    });

    return this.initializationPromise;
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializeDictionary();
    }
  }

  async calculateContentQualityScore(spellingErrorCount) {
    let score = 100;

    // Deduct points for spelling errors
    score -= Math.min(spellingErrorCount * 8, 50);

    return Math.max(0, score);
  }

  async checkContent(content, title = "", metaDescription = "") {
    this.stats.textsChecked++;

    const issues = {
      spelling: [],
      readability: {},
    };

    try {
      // Ensure dictionary is loaded
      await this.ensureInitialized();

      // Check title for spelling
      if (title) {
        const titleIssues = await this.checkText(title, "title");
        issues.spelling.push(...titleIssues.spelling);
      }

      // Check meta description for spelling
      if (metaDescription) {
        const metaIssues = await this.checkText(
          metaDescription,
          "meta_description"
        );
        issues.spelling.push(...metaIssues.spelling);
      }

      // Check content for spelling (limited to first 2000 words)
      if (content) {
        const limitedContent = this.limitContentForChecking(content);
        const contentIssues = await this.checkText(limitedContent, "content");
        issues.spelling.push(...contentIssues.spelling);
      }

      // Calculate readability metrics
      issues.readability = this.calculateReadabilityMetrics(content);

      // Update stats
      this.stats.spellingErrorsFound += issues.spelling.length;
      this.stats.totalIssuesFound += issues.spelling.length;

      // Return simplified structure
      return {
        spellingErrors: issues.spelling.map((error) =>
          error.word
            ? `${error.word}${
                error.suggestions && error.suggestions.length > 0
                  ? ` (suggestion: ${error.suggestions[0]})`
                  : ""
              }`
            : error.text || "Unknown spelling error"
        ),
        readabilityScore: issues.readability,
        contentQualityScore: await this.calculateContentQualityScore(
          issues.spelling.length
        ),
        spelling: issues.spelling, // Detailed errors for processing
        _detailed: issues,
      };
    } catch (error) {
      logger.error("Error checking spelling", error);
      return {
        spellingErrors: [],
        readabilityScore: {},
        contentQualityScore: 100,
        spelling: [],
        error: error.message,
      };
    }
  }

  async checkText(text, section) {
    const issues = {
      spelling: [],
    };

    if (!text || typeof text !== "string") {
      return issues;
    }

    const cleanText = this.cleanTextForAnalysis(text);
    const spellingErrors = await this.findSpellingErrors(cleanText, section);
    issues.spelling.push(...spellingErrors);

    return issues;
  }

  cleanTextForAnalysis(text) {
    return text
      .replace(/[^\w\s\.\,\!\?\;\:\'\"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  limitContentForChecking(content) {
    const words = content.split(/\s+/);
    if (words.length > 2000) {
      return words.slice(0, 2000).join(" ");
    }
    return content;
  }

  async findSpellingErrors(text, section) {
    const errors = [];
    
    if (!this.dictionary) {
      logger.warn("Dictionary not initialized, skipping spell check");
      return errors;
    }

    const words = text.split(/\s+/);

    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      
      // Handle contractions specially - preserve apostrophes
      const cleanWord = this.cleanWordPreservingContractions(word);

      // Skip short words, numbers, and ignored words
      if (cleanWord.length < 2) continue;
      if (/^\d+$/.test(cleanWord)) continue;
      if (this.ignoreWords.has(cleanWord.toLowerCase())) continue;

      // Skip words with mixed case (likely brand names or acronyms)
      const originalClean = word.replace(/[^\w']/g, ""); // Keep apostrophes
      if (this.hasMixedCase(originalClean)) continue;

      // Skip words that are all uppercase (likely acronyms)
      if (originalClean === originalClean.toUpperCase() && originalClean.length > 1) {
        continue;
      }

      // Check if it's a valid contraction first
      if (this.isValidContraction(cleanWord.toLowerCase())) {
        continue; // Skip valid contractions
      }

      // Check if word is spelled correctly
      const isCorrect = this.dictionary.spellCheck(cleanWord.toLowerCase());

      if (!isCorrect) {
        // Get suggestions for misspelled word
        const suggestions = this.dictionary.getSuggestions(cleanWord.toLowerCase(), 3);

        errors.push({
          type: "spelling",
          word: cleanWord,
          originalWord: word,
          suggestions: suggestions || [],
          position: index,
          section: section,
          context: this.getWordContext(words, index),
          severity: "medium",
        });
      }
    }

    return errors;
  }

  // Clean word while preserving apostrophes for contractions
  cleanWordPreservingContractions(word) {
    // Remove all punctuation except apostrophes
    // Also remove leading/trailing apostrophes (like 'word' becomes word)
    let cleaned = word.replace(/[^\w']/g, "");
    
    // Remove leading and trailing apostrophes
    cleaned = cleaned.replace(/^'+|'+$/g, "");
    
    return cleaned;
  }

  // Check if a word is a valid English contraction
  isValidContraction(word) {
    const validContractions = new Set([
      // Common contractions
      "i'm", "i'd", "i'll", "i've",
      "you're", "you'd", "you'll", "you've",
      "he's", "he'd", "he'll",
      "she's", "she'd", "she'll",
      "it's", "it'd", "it'll",
      "we're", "we'd", "we'll", "we've",
      "they're", "they'd", "they'll", "they've",
      "that's", "that'd", "that'll",
      "who's", "who'd", "who'll",
      "what's", "what'd", "what'll",
      "where's", "where'd",
      "when's", "when'd",
      "why's", "why'd",
      "how's", "how'd",
      
      // Negative contractions
      "isn't", "aren't", "wasn't", "weren't",
      "hasn't", "haven't", "hadn't",
      "doesn't", "don't", "didn't",
      "won't", "wouldn't",
      "can't", "cannot", "couldn't",
      "shouldn't", "mightn't", "mustn't",
      
      // Other common contractions
      "let's", "that's", "there's", "here's",
      "ain't", "gonna", "gotta", "wanna",
      "y'all", "ma'am",
      
      // Possessive forms (common ones)
      "o'clock",
      
      // Could have, would have, should have
      "could've", "would've", "should've",
      "might've", "must've",
    ]);

    return validContractions.has(word.toLowerCase());
  }

  hasMixedCase(word) {
    if (word.length < 2) return false;
    
    let hasUpper = false;
    let hasLower = false;

    for (let i = 1; i < word.length; i++) { // Start from index 1 (skip first letter)
      if (word[i] === word[i].toUpperCase() && /[a-zA-Z]/.test(word[i])) {
        hasUpper = true;
      }
      if (word[i] === word[i].toLowerCase() && /[a-zA-Z]/.test(word[i])) {
        hasLower = true;
      }
    }

    return hasUpper && hasLower;
  }

  getWordContext(words, index) {
    const start = Math.max(0, index - 3);
    const end = Math.min(words.length, index + 4);
    const context = words.slice(start, end);

    // Highlight the problematic word
    if (index - start >= 0 && index - start < context.length) {
      context[index - start] = `**${context[index - start]}**`;
    }

    return context.join(" ");
  }

  calculateReadabilityMetrics(content) {
    if (!content || typeof content !== "string") {
      return {
        score: 0,
        fleschReadingEase: 0,
        fleschKincaidGrade: 0,
        readingLevel: "Unknown",
      };
    }

    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);
    const words = content.split(/\s+/).filter((w) => w.length > 0);
    const syllables = this.countSyllables(content);

    if (sentences.length === 0 || words.length === 0) {
      return {
        score: 0,
        fleschReadingEase: 0,
        fleschKincaidGrade: 0,
        readingLevel: "Unknown",
      };
    }

    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    // Flesch Reading Ease Score
    const fleschScore =
      206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;

    // Flesch-Kincaid Grade Level
    const fleschKincaidGrade =
      0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

    return {
      score: Math.round(fleschScore * 10) / 10,
      fleschReadingEase: Math.round(fleschScore * 10) / 10,
      fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
      readingLevel: this.getReadingLevel(fleschScore),
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 10) / 10,
      totalWords: words.length,
      totalSentences: sentences.length,
      totalSyllables: syllables,
    };
  }

  countSyllables(text) {
    const words = text.toLowerCase().split(/\s+/);
    let totalSyllables = 0;

    words.forEach((word) => {
      const cleanWord = word.replace(/[^\w]/g, "");
      if (cleanWord.length > 0) {
        totalSyllables += this.countWordSyllables(cleanWord);
      }
    });

    return totalSyllables;
  }

  countWordSyllables(word) {
    if (word.length <= 3) return 1;

    // Count vowel groups
    const vowelGroups = word.match(/[aeiouy]+/g);
    let syllables = vowelGroups ? vowelGroups.length : 1;

    // Subtract silent 'e'
    if (word.endsWith("e")) syllables--;

    // Handle special cases
    if (
      word.endsWith("le") &&
      word.length > 2 &&
      !/[aeiouy]/.test(word[word.length - 3])
    ) {
      syllables++;
    }

    return Math.max(1, syllables);
  }

  getReadingLevel(fleschScore) {
    if (fleschScore >= 90) return "Very Easy";
    if (fleschScore >= 80) return "Easy";
    if (fleschScore >= 70) return "Fairly Easy";
    if (fleschScore >= 60) return "Standard";
    if (fleschScore >= 50) return "Fairly Difficult";
    if (fleschScore >= 30) return "Difficult";
    return "Very Difficult";
  }

  // Add words to ignore list dynamically
  addIgnoreWords(words) {
    if (Array.isArray(words)) {
      words.forEach((word) => {
        this.ignoreWords.add(word.toLowerCase());
      });
    }
  }

  // Check if dictionary is ready
  isReady() {
    return this.isInitialized;
  }

  getStats() {
    return {
      ...this.stats,
      isInitialized: this.isInitialized,
      avgIssuesPerText:
        this.stats.textsChecked > 0
          ? (this.stats.totalIssuesFound / this.stats.textsChecked).toFixed(2)
          : 0,
      spellingErrorRate:
        this.stats.textsChecked > 0
          ? (this.stats.spellingErrorsFound / this.stats.textsChecked).toFixed(
              2
            )
          : 0,
    };
  }
}

module.exports = SpellingChecker;

