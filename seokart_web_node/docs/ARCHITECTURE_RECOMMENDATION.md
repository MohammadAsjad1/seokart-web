# Crawler Architecture: Best Fit for This Project

## Speed tuning (target: ~2500 pages in 25–30 min total)

Defaults in `config/scraper.js` are tuned for this. Override with env if needed:

| Env | Default | Purpose |
|-----|---------|--------|
| `FAST_SCRAPER_CONCURRENCY` | 20 | Parallel page fetches |
| `FAST_SCRAPE_BATCH` | 50 | URLs per scrape batch |
| `FAST_SCRAPER_BATCH_DELAY_MS` | 50 | Delay between batches (ms) |
| `SLOW_ANALYZER_CONCURRENCY` | 12 | Duplicate/score phase concurrency |
| `LINK_VALIDATION_CONCURRENCY` | 20 | Pages validated in parallel |
| `LINK_VALIDATION_BATCH` | 50 | Pages per link-validation batch |
| `LINK_CHECKS_PER_PAGE` | 40 | Concurrent link checks per page |
| `LINK_CHECK_TIMEOUT_MS` | 2000 | Timeout per link (ms) |
| `LINK_VALIDATION_MAX_LINKS_PER_PAGE` | 80 | Cap links per page (0 = no cap) |
| `DUPLICATE_CHECK_BATCH` | 60 | Pages per duplicate batch |

---

## Recommendation: **Keep current design** (no separate Link Validator stage)

For this project’s scale and setup, the existing pipeline is the right fit.

---

## Why this fits

| Factor | Your setup | Implication |
|--------|------------|-------------|
| **Scale** | ~500 URLs/crawl, 3 concurrent users, 100–50k pages/month by plan | Single-process pipeline is enough; no need for a separate queue stage. |
| **Runtime** | One Node process, in-memory job manager, no Redis/Bull between stages | Adding “Link Validator workers” as a real separate stage would mean new queues and workers; high cost for little gain. |
| **Order** | Sitemaps → Scraper → Analyzer (duplicate → link validation → scores) | Order is correct; link validation already runs after analysis data is ready. |
| **Simplicity** | One job lifecycle, one stop/retry/crash-recovery path | Easier to reason about and maintain. |

So: **Scraper Workers → Analyzer Workers** (with link validation as a phase inside the Analyzer) is the right architecture for this project. A separate “Link Validator Workers” stage is not recommended unless you later move to multi-node workers and a job queue.

---

## Suggested improvements (without changing the pipeline)

### 1. Dedicated concurrency for link validation (recommended)

Right now link validation uses `config.concurrency.slow_analyzer` (5) for “how many pages in parallel.” So duplicate detection, link validation, and score recalc all share the same concurrency. Link validation is I/O-bound (HTTP); the others are more CPU/memory-bound. Giving link validation its own limit avoids one phase starving the others.

**Change:** Add `link_validation` to `config/scraper.js` and use it only in the link-validation phase of `slow-analyzer.js`.

- In **config**: add `link_validation: parseInt(process.env.LINK_VALIDATION_CONCURRENCY) || 5` (or 8) under `concurrency`.
- In **slow-analyzer** `validateLinks()`: use `config.concurrency.link_validation` instead of `config.concurrency.slow_analyzer` for the limiter.

No new worker stage; just better tuning.

### 2. Align LinkProcessor’s internal limit with config

`link-processor.js` uses a hardcoded `pLimit(20)` for “concurrent link checks per page.” Consider:

- Reading a value from config (e.g. `config.concurrency.link_checks_per_page` or reusing a single `link_validation`-related setting), or
- At least documenting that 20 is the per-page link-check concurrency so you can tune it later.

### 3. Optional: make link validation skippable

If you want faster “analysis complete” for users and can show link results later:

- Add a job/crawl option like `skipLinkValidation: true` or `deferLinkValidation: true`.
- When set, the Analyzer runs duplicate detection and score recalc only; link validation is skipped or run in a follow-up background step (still inside the same process/job, not a new queue).

Only worth it if you have large crawls and need to show scores/duplicates before link checks finish.

### 4. When to consider a true 3-stage pipeline

Revisit a separate **Scraper → Analyzer → Link Validator** worker pipeline only if you:

- Scale to many more URLs per crawl (e.g. 10k+),
- Run multiple worker processes/nodes with a shared queue (e.g. Bull + Redis), or
- Need to scale or retry link validation independently from analysis.

Until then, the current two-stage design (Scraper → Analyzer with internal phases) is the best fit.

---

## Summary

- **Best fit for this project:** Keep **Scraper Workers → Analyzer Workers**, with link validation as a phase inside the Analyzer.
- **Good optional improvement:** Add a dedicated `link_validation` concurrency in config and use it in the link-validation phase; optionally make LinkProcessor’s per-page limit configurable.
- **Not recommended now:** Introducing a separate Link Validator worker stage or a 3-stage queue; that’s for when you scale out and add a proper job queue.
