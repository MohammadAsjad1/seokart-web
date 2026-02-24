module.exports = {
  concurrency: {
    fast_scraper: parseInt(process.env.FAST_SCRAPER_CONCURRENCY) || 15,
    slow_analyzer: parseInt(process.env.SLOW_ANALYZER_CONCURRENCY) || 12,
    sitemap_processing: parseInt(process.env.SITEMAP_CONCURRENCY) || 5,
    max_users: parseInt(process.env.MAX_CONCURRENT_USERS) || 10
  },

  timeouts: {
    quick_request: 4000,
    standard_request: 8000,
    heavy_request: 15000,
    sitemap_fetch: 12000,
    link_check: 3000
  },

  batch_sizes: {
    fast_scrape: 25,
    slow_analysis: 15,
    duplicate_check: 50,
    link_validation: 40
  },

  rate_limits: {
    base_delay: 250,
    max_delay: 8000,
    error_multiplier: 1.5,
    success_reduction: 0.8,
    domain_cooldown: 30000
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
    health_check_interval: 60000 // 1 minute
  }
};