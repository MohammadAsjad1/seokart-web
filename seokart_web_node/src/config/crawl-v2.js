/**
 * Crawl V2 – high-scale sitemap crawl (100K pages, 50–1000 concurrent users).
 * Two-worker architecture: Phase1 = sitemap + scrape, Phase2 = analyze (grammar, duplicate, links, score).
 */

const LOCK_12H = 12 * 60 * 60 * 1000;
const LOCK_8H = 8 * 60 * 60 * 1000;

module.exports = {
  /** Max pages per single crawl (sitemap URL cap is applied before scrape) */
  maxPagesPerCrawl:
    parseInt(process.env.CRAWL_V2_MAX_PAGES_PER_CRAWL, 10) || 100000,

  /** Max sitemap URLs accepted in request (same as original) */
  maxSitemapUrls: parseInt(process.env.CRAWL_V2_MAX_SITEMAP_URLS, 10) || 500,

  /** Phase1 job lock (sitemap + scrape can run many hours for 100K) */
  phase1LockDurationMs:
    parseInt(process.env.CRAWL_V2_PHASE1_LOCK_MS, 10) || LOCK_12H,

  /** Phase2 job lock (chunked analysis) */
  phase2LockDurationMs:
    parseInt(process.env.CRAWL_V2_PHASE2_LOCK_MS, 10) || LOCK_8H,

  /** Chunk size for Phase2 analysis (duplicate/link/score) */
  phase2ChunkSize:
    parseInt(process.env.CRAWL_V2_PHASE2_CHUNK_SIZE, 10) || 1000,

  /** Phase1 worker concurrency (jobs at a time per process) */
  phase1WorkerConcurrency:
    parseInt(process.env.CRAWL_V2_PHASE1_WORKER_CONCURRENCY, 10) || 5,

  /** Phase2 worker concurrency */
  phase2WorkerConcurrency:
    parseInt(process.env.CRAWL_V2_PHASE2_WORKER_CONCURRENCY, 10) || 10,
};
