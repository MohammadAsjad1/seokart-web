const logger = require("../config/logger");
const nspell = require("nspell");

class SpellingChecker {
  constructor() {
    this.dictionary = null; // kept for backward compatibility
    this.dictionaryUS = null;
    this.dictionaryGB = null;

    this.isInitialized = false;
    this.initializationPromise = null;

    // Words to ignore (unchanged)
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

    this.initializeDictionary().catch(() => {
      logger.error("Failed to load spell checker dictionary");
    });
  }

  async initializeDictionary() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const { default: dictUS } = await import("dictionary-en");
        const { default: dictGB } = await import("dictionary-en-gb");

        this.dictionaryUS = nspell(dictUS);
        this.dictionaryGB = nspell(dictGB);

        // Add ignore words to BOTH
        for (const word of this.ignoreWords) {
          this.dictionaryUS.add(word);
          this.dictionaryGB.add(word);
        }

        this.isInitialized = true;
        logger.info("Spell checker (US + GB) loaded successfully");
      } catch (err) {
        this.initializationPromise = null;
        logger.error("Failed to load spell checker dictionary", err);
        throw err;
      }
    })();

    return this.initializationPromise;
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializeDictionary();
    }
  }

  // Combined correctness check
  isCorrect(word) {
    return this.dictionaryUS.correct(word) || this.dictionaryGB.correct(word);
  }

  // Merge suggestions
  getSuggestions(word) {
    const us = this.dictionaryUS.suggest(word) || [];
    const gb = this.dictionaryGB.suggest(word) || [];

    return [...new Set([...us, ...gb])].slice(0, 3);
  }

  // Smart filtering
  shouldSkipWord(word) {
    const lower = word.toLowerCase();

    if (this.ignoreWords.has(lower)) return true;

    // domains / urls
    if (/\.(com|net|org|io|ai|co|in)/.test(lower)) return true;

    // long garbage words (like dashboarddeskmozcom)
    if (lower.length > 15) return true;

    // alphanumeric combos
    if (/[a-z]+\d+|\d+[a-z]+/.test(lower)) return true;

    // camelCase
    if (/[a-z][A-Z]/.test(word)) return true;

    return false;
  }

  async calculateContentQualityScore(spellingErrorCount) {
    let score = 100;
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
      await this.ensureInitialized();

      if (title) {
        const titleIssues = await this.checkText(title, "title");
        issues.spelling.push(...titleIssues.spelling);
      }

      if (metaDescription) {
        const metaIssues = await this.checkText(
          metaDescription,
          "meta_description",
        );
        issues.spelling.push(...metaIssues.spelling);
      }

      if (content) {
        const limitedContent = this.limitContentForChecking(content);
        const contentIssues = await this.checkText(limitedContent, "content");
        issues.spelling.push(...contentIssues.spelling);
      }

      issues.readability = this.calculateReadabilityMetrics(content);

      this.stats.spellingErrorsFound += issues.spelling.length;
      this.stats.totalIssuesFound += issues.spelling.length;

      return {
        spellingErrors: issues.spelling.map((error) =>
          error.word
            ? `${error.word}${
                error.suggestions && error.suggestions.length > 0
                  ? ` (suggestion: ${error.suggestions[0]})`
                  : ""
              }`
            : error.text || "Unknown spelling error",
        ),
        readabilityScore: issues.readability,
        contentQualityScore: await this.calculateContentQualityScore(
          issues.spelling.length,
        ),
        spelling: issues.spelling,
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
    const issues = { spelling: [] };

    if (!text || typeof text !== "string") return issues;

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
    if (typeof content !== "string") return "";

    const words = content.split(/\s+/);
    if (words.length > 2000) {
      return words.slice(0, 2000).join(" ");
    }
    return content;
  }

  async findSpellingErrors(text, section) {
    const errors = [];

    if (!this.dictionaryUS || !this.dictionaryGB) {
      logger.warn("Dictionary not initialized");
      return errors;
    }

    const reportedWords = new Set();
    const words = text.split(/\s+/);

    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      const cleanWord = this.cleanWordPreservingContractions(word);

      if (cleanWord.length < 2) continue;
      if (/^\d+$/.test(cleanWord)) continue;

      if (this.shouldSkipWord(cleanWord)) continue;

      const originalClean = word.replace(/[^\w']/g, "");
      if (this.hasMixedCase(originalClean)) continue;

      if (
        originalClean === originalClean.toUpperCase() &&
        originalClean.length > 1
      ) {
        continue;
      }

      if (this.isValidContraction(cleanWord.toLowerCase())) continue;

      const wordLower = cleanWord.toLowerCase();
      if (reportedWords.has(wordLower)) continue;

      const isCorrect = this.isCorrect(wordLower) || this.isCorrect(cleanWord);

      if (!isCorrect) {
        const suggestions = this.getSuggestions(wordLower);

        reportedWords.add(wordLower);

        errors.push({
          type: "spelling",
          word: cleanWord,
          originalWord: word,
          suggestions,
          position: index,
          section,
          context: this.getWordContext(words, index),
          severity: "medium",
        });
      }
    }

    return errors;
  }


  cleanWordPreservingContractions(word) {
    let cleaned = word.replace(/[^\w']/g, "");
    cleaned = cleaned.replace(/^'+|'+$/g, "");
    return cleaned;
  }

  isValidContraction(word) {
    const validContractions = new Set([
      "i'm",
      "i'd",
      "i'll",
      "i've",
      "you're",
      "you'd",
      "you'll",
      "you've",
      "he's",
      "he'd",
      "he'll",
      "she's",
      "she'd",
      "she'll",
      "it's",
      "it'd",
      "it'll",
      "we're",
      "we'd",
      "we'll",
      "we've",
      "they're",
      "they'd",
      "they'll",
      "they've",
      "that's",
      "that'd",
      "that'll",
      "who's",
      "who'd",
      "who'll",
      "what's",
      "what'd",
      "what'll",
      "where's",
      "where'd",
      "when's",
      "when'd",
      "why's",
      "why'd",
      "how's",
      "how'd",
      "isn't",
      "aren't",
      "wasn't",
      "weren't",
      "hasn't",
      "haven't",
      "hadn't",
      "doesn't",
      "don't",
      "didn't",
      "won't",
      "wouldn't",
      "can't",
      "cannot",
      "couldn't",
      "shouldn't",
      "mightn't",
      "mustn't",
      "let's",
      "there's",
      "here's",
      "ain't",
      "gonna",
      "gotta",
      "wanna",
      "y'all",
      "ma'am",
      "o'clock",
      "could've",
      "would've",
      "should've",
      "might've",
      "must've",
    ]);

    return validContractions.has(word.toLowerCase());
  }

  hasMixedCase(word) {
    if (word.length < 2) return false;

    let hasUpper = false;
    let hasLower = false;

    for (let i = 1; i < word.length; i++) {
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
        if (typeof word !== "string" || !word.trim()) {
          return;
        }

        const lower = word.toLowerCase();
        this.ignoreWords.add(lower);

        // Also add live into nspell dictionary if already initialized
        if (this.isInitialized && this.dictionary) {
          this.dictionary.add(lower);
        }
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
              2,
            )
          : 0,
    };
  }
}

module.exports = SpellingChecker;
