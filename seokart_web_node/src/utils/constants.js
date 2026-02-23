// Application constants

// Processing statuses
const PROCESSING_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors'
};

// Crawling phases
const CRAWL_PHASES = {
  SITEMAP_PROCESSING: 'sitemap_processing',
  FAST_SCRAPING: 'fast_scraping',
  SLOW_ANALYSIS: 'slow_analysis',
  DUPLICATE_DETECTION: 'duplicate_detection',
  LINK_VALIDATION: 'link_validation',
  SCORE_CALCULATION: 'score_calculation',
  COMPLETED: 'completed'
};

// SEO score grades
const SEO_GRADES = {
  A: { min: 90, max: 100, label: 'Excellent' },
  B: { min: 80, max: 89, label: 'Good' },
  C: { min: 70, max: 79, label: 'Average' },
  D: { min: 60, max: 69, label: 'Poor' },
  F: { min: 0, max: 59, label: 'Very Poor' }
};

// URL types
const URL_TYPES = {
  SITEMAP: 0,
  WEBPAGE: 1
};

// HTTP status codes
const HTTP_STATUS = {
  OK: 200,
  REDIRECT: 301,
  TEMP_REDIRECT: 302,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Error types
const ERROR_TYPES = {
  VALIDATION_ERROR: 'validation_error',
  NETWORK_ERROR: 'network_error',
  TIMEOUT_ERROR: 'timeout_error',
  PARSING_ERROR: 'parsing_error',
  RATE_LIMIT_ERROR: 'rate_limit_error',
  AUTHENTICATION_ERROR: 'authentication_error',
  PERMISSION_ERROR: 'permission_error',
  SYSTEM_ERROR: 'system_error',
  DATABASE_ERROR: 'database_error'
};

// Notification types
const NOTIFICATION_TYPES = {
  PROGRESS_UPDATE: 'progress_update',
  CRAWL_STARTED: 'crawl_started',
  CRAWL_COMPLETED: 'crawl_completed',
  PHASE_UPDATE: 'phase_update',
  ERROR: 'error',
  WARNING: 'warning',
  SYSTEM_STATUS: 'system_status',
  BATCH_UPDATE: 'batch_update',
  PERFORMANCE_METRICS: 'performance_metrics'
};

// System health statuses
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  CRITICAL: 'critical',
  MAINTENANCE: 'maintenance'
};

// Content types
const CONTENT_TYPES = {
  HTML: 'text/html',
  XML: 'application/xml',
  JSON: 'application/json',
  TEXT: 'text/plain',
  PDF: 'application/pdf',
  IMAGE: 'image/*',
  CSS: 'text/css',
  JAVASCRIPT: 'application/javascript'
};

// Common file extensions
const FILE_EXTENSIONS = {
  IMAGES: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  DOCUMENTS: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'],
  STYLESHEETS: ['css', 'scss', 'sass', 'less'],
  SCRIPTS: ['js', 'jsx', 'ts', 'tsx'],
  FONTS: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
  VIDEOS: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
  AUDIO: ['mp3', 'wav', 'ogg', 'aac', 'flac']
};

// User agent categories
const USER_AGENT_TYPES = {
  DESKTOP_CHROME: 'desktop_chrome',
  DESKTOP_FIREFOX: 'desktop_firefox',
  DESKTOP_SAFARI: 'desktop_safari',
  DESKTOP_EDGE: 'desktop_edge',
  MOBILE_CHROME: 'mobile_chrome',
  MOBILE_SAFARI: 'mobile_safari',
  BOT: 'bot'
};

// Rate limiting types
const RATE_LIMIT_TYPES = {
  BY_IP: 'by_ip',
  BY_USER: 'by_user',
  BY_DOMAIN: 'by_domain',
  GLOBAL: 'global'
};

// Cache types
const CACHE_TYPES = {
  MEMORY: 'memory',
  REDIS: 'redis',
  FILE: 'file',
  DATABASE: 'database'
};

// Priority levels
const PRIORITY_LEVELS = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
  CRITICAL: 5
};

// Time constants (in milliseconds)
const TIME_CONSTANTS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000
};

// Memory thresholds (in MB)
const MEMORY_THRESHOLDS = {
  LOW: 512,
  MODERATE: 1024,
  HIGH: 2048,
  CRITICAL: 4096
};

// Performance metrics
const PERFORMANCE_THRESHOLDS = {
  RESPONSE_TIME: {
    EXCELLENT: 1000,
    GOOD: 3000,
    ACCEPTABLE: 5000,
    POOR: 10000
  },
  SUCCESS_RATE: {
    EXCELLENT: 95,
    GOOD: 90,
    ACCEPTABLE: 80,
    POOR: 70
  },
  THROUGHPUT: {
    HIGH: 10,
    MEDIUM: 5,
    LOW: 2
  }
};

// SEO score weights
const SEO_SCORE_WEIGHTS = {
  TITLE: 0.20,
  META_DESCRIPTION: 0.15,
  CONTENT: 0.20,
  HEADINGS: 0.10,
  URL: 0.05,
  TECHNICAL: 0.10,
  IMAGES: 0.05,
  LINKS: 0.10,
  PERFORMANCE: 0.03,
  DUPLICATES: 0.02
};

// Content analysis thresholds
const CONTENT_THRESHOLDS = {
  TITLE: {
    MIN_LENGTH: 30,
    MAX_LENGTH: 60,
    OPTIMAL_MIN: 40,
    OPTIMAL_MAX: 55
  },
  META_DESCRIPTION: {
    MIN_LENGTH: 120,
    MAX_LENGTH: 160,
    OPTIMAL_MIN: 140,
    OPTIMAL_MAX: 155
  },
  CONTENT: {
    MIN_WORDS: 300,
    OPTIMAL_WORDS: 500,
    MAX_WORDS: 2000
  },
  URL: {
    MAX_LENGTH: 75,
    OPTIMAL_LENGTH: 50
  }
};

// Duplicate detection thresholds
const DUPLICATE_THRESHOLDS = {
  EXACT_MATCH: 1.0,
  HIGH_SIMILARITY: 0.95,
  MODERATE_SIMILARITY: 0.8,
  LOW_SIMILARITY: 0.6
};

// Link validation categories
const LINK_CATEGORIES = {
  INTERNAL: 'internal',
  EXTERNAL: 'external',
  SOCIAL_MEDIA: 'social_media',
  EMAIL: 'email',
  PHONE: 'phone',
  DOWNLOAD: 'download',
  ANCHOR: 'anchor'
};

// Common domain suffixes for validation
const DOMAIN_SUFFIXES = [
  '.com', '.org', '.net', '.edu', '.gov', '.mil', '.int',
  '.co.uk', '.com.au', '.de', '.fr', '.it', '.es', '.ca',
  '.jp', '.cn', '.in', '.br', '.ru', '.nl', '.se', '.no'
];

// Social media domains
const SOCIAL_MEDIA_DOMAINS = [
  'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
  'youtube.com', 'pinterest.com', 'tiktok.com', 'snapchat.com',
  'reddit.com', 'tumblr.com', 'discord.com', 'whatsapp.com'
];

// Search engine domains
const SEARCH_ENGINE_DOMAINS = [
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'baidu.com', 'yandex.com', 'ask.com', 'aol.com'
];

// Default configurations
const DEFAULT_CONFIG = {
  CONCURRENCY: {
    FAST_SCRAPER: 15,
    SLOW_ANALYZER: 8,
    SITEMAP_PROCESSING: 5,
    MAX_USERS: 10
  },
  TIMEOUTS: {
    QUICK_REQUEST: 4000,
    STANDARD_REQUEST: 8000,
    HEAVY_REQUEST: 15000,
    SITEMAP_FETCH: 12000,
    LINK_CHECK: 3000
  },
  BATCH_SIZES: {
    FAST_SCRAPE: 25,
    SLOW_ANALYSIS: 15,
    DUPLICATE_CHECK: 50,
    LINK_VALIDATION: 30
  },
  RATE_LIMITS: {
    BASE_DELAY: 250,
    MAX_DELAY: 8000,
    ERROR_MULTIPLIER: 1.5,
    SUCCESS_REDUCTION: 0.8
  }
};

// Export all constants
module.exports = {
  PROCESSING_STATUS,
  CRAWL_PHASES,
  SEO_GRADES,
  URL_TYPES,
  HTTP_STATUS,
  ERROR_TYPES,
  NOTIFICATION_TYPES,
  HEALTH_STATUS,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  USER_AGENT_TYPES,
  RATE_LIMIT_TYPES,
  CACHE_TYPES,
  PRIORITY_LEVELS,
  TIME_CONSTANTS,
  MEMORY_THRESHOLDS,
  PERFORMANCE_THRESHOLDS,
  SEO_SCORE_WEIGHTS,
  CONTENT_THRESHOLDS,
  DUPLICATE_THRESHOLDS,
  LINK_CATEGORIES,
  DOMAIN_SUFFIXES,
  SOCIAL_MEDIA_DOMAINS,
  SEARCH_ENGINE_DOMAINS,
  DEFAULT_CONFIG
};