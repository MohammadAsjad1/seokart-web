module.exports = {
  // Tuned for ~2500 pages in ~25–30 min total (sitemap + scrape + analyzer)
  concurrency: {
    fast_scraper: parseInt(process.env.FAST_SCRAPER_CONCURRENCY) || 20,
    slow_analyzer: parseInt(process.env.SLOW_ANALYZER_CONCURRENCY) || 12,
    link_validation: parseInt(process.env.LINK_VALIDATION_CONCURRENCY) || 10,
    link_checks_per_page: parseInt(process.env.LINK_CHECKS_PER_PAGE) || 30,
    sitemap_processing: parseInt(process.env.SITEMAP_CONCURRENCY) || 8,
    max_users: parseInt(process.env.MAX_CONCURRENT_USERS) || 3
  },

  timeouts: {
    quick_request: 5000,
    standard_request: 8000,
    heavy_request: 15000,
    sitemap_fetch: 12000,
    link_check: parseInt(process.env.LINK_CHECK_TIMEOUT_MS) || 3000
  },

  batch_sizes: {
    fast_scrape: parseInt(process.env.FAST_SCRAPE_BATCH) || 50,
    slow_analysis: 20,
    duplicate_check: parseInt(process.env.DUPLICATE_CHECK_BATCH) || 60,
    link_validation: parseInt(process.env.LINK_VALIDATION_BATCH) || 50,
    score_recalc: parseInt(process.env.SCORE_RECALC_BATCH) || 40
  },

  rate_limits: {
    base_delay: 150,
    max_delay: 6000,
    error_multiplier: 1.5,
    success_reduction: 0.8,
    domain_cooldown: 20000
  },

  // Inter-batch delays (ms) - lower = faster, watch for rate limits
  batch_delays: {
    fast_scraper: parseInt(process.env.FAST_SCRAPER_BATCH_DELAY_MS) || 50,
    duplicate_check: 30,
    link_validation: 50,
  },

  memory: {
    max_heap_mb: parseInt(process.env.MAX_HEAP_MB) || 2048,
    gc_threshold: 0.75,
    cleanup_interval: 300000 // 5 minutes
  },

  user_agents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
  ],

  seo: {
    title_min_length: 30,
    title_max_length: 60,
    meta_desc_min_length: 120,
    meta_desc_max_length: 160,
    content_min_words: 300,
    max_content_length: 8000, // for performance
    url_max_length: 75
  },

  job_queues: {
    fast_scraper: {
      attempts: 3,
      backoff_delay: 2000,
      remove_on_complete: 100,
      remove_on_fail: 50
    },
    slow_analyzer: {
      attempts: 2,
      backoff_delay: 5000,
      remove_on_complete: 50,
      remove_on_fail: 25
    }
  },

  performance: {
    progress_update_threshold: 10, // update progress every 10 items
    socket_emit_throttle: 2000, // 2 seconds
    stats_collection_interval: 30000, // 30 seconds
    health_check_interval: 60000, // 1 minute
    link_validation_max_links_per_page: parseInt(process.env.LINK_VALIDATION_MAX_LINKS_PER_PAGE) || 80, // cap to avoid one page dominating; 0 = no cap
    // Max links stored per page at scrape time (for later validation without re-fetch). 0 = use default.
    max_links_stored_per_page: parseInt(process.env.MAX_LINKS_STORED_PER_PAGE) || 300
  },

  // Redis cache for link validation results (same URL = one HTTP check per TTL across all pages/users)
  link_validation_cache: {
    enabled: process.env.LINK_VALIDATION_CACHE_ENABLED !== "false",
    ttl_seconds: parseInt(process.env.LINK_VALIDATION_CACHE_TTL_SECONDS, 10) || 1800, // 30 min default
    key_prefix: process.env.LINK_VALIDATION_CACHE_KEY_PREFIX || "lv:",
    max_key_length: 400, // URLs longer than this are stored under sha256 hash
  }
};