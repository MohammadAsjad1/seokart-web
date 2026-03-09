const cheerio = require("cheerio");
const { Jenkins } = require("simhash-js");
const logger = require("../config/logger");

// ─── Constants ────────────────────────────────────────────────────────────────
const SIMHASH_HAMMING_THRESHOLD = 3; // 64-bit: only ~95%+ match (1 - 3/64). Stricter to avoid false duplicates.
const SIMHASH_MAX_FEATURES = 128;
const WORD_SHINGLE_SIZE = 3;
const SIMHASH_BITS = 64;
const JENKINS_SALT_HIGH = "\x01"; // salt for high 32 bits of 64-bit shingle hash

const STORE_MAX_TITLES = 50000;
const STORE_MAX_DESCRIPTIONS = 50000;
const STORE_MAX_BUCKET_ENTRIES = 200000;

const REDIS_KEY_PREFIX = "dup";

// ─── Scoring weights ──────────────────────────────────────────────────────────
const SCORE_PENALTIES = {
  title: {
    exact_match: 30,
    near_exact: 25,
    high_similarity: 15,
  },
  description: {
    exact_match: 20,
    near_exact: 15,
    high_similarity: 10,
  },
  content: {
    exact_match: 40, // similarity >= 0.99
    near_exact: 25, // similarity >= 0.85
    high_similarity: 10, // similarity >= 0.70
  },
};

// ─────────────────────────────────────────────────────────────────────────────

class DuplicateProcessorV2 {
  constructor(options = {}) {
    this.redis = options.redis ?? null;
    this.stats = {
      webpagesAnalyzed: 0,
      titleDuplicatesFound: 0,
      descriptionDuplicatesFound: 0,
      contentDuplicatesFound: 0,
    };
  }

  /** Redis key prefix for a run: dup:{userActivityId}: */
  _prefix(userActivityId) {
    return `${REDIS_KEY_PREFIX}:${userActivityId}:`;
  }

  /** Normalize Redis client (supports ioredis lowercase or node-redis v4 camelCase). Bind to client so ioredis receives correct `this`. */
  _redis(store) {
    if (!store?.redis) return null;
    const r = store.redis;
    return {
      hGet: (r.hGet ?? r.hget).bind(r),
      hSet: (r.hSet ?? r.hset).bind(r),
      hLen: (r.hLen ?? r.hlen).bind(r),
      sAdd: (r.sAdd ?? r.sadd).bind(r),
      sMembers: (r.sMembers ?? r.smembers).bind(r),
      get: r.get.bind(r),
      incrBy: (r.incrBy ?? r.incrby).bind(r),
      scan: r.scan.bind(r),
      del: r.del.bind(r),
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * TWO-PASS duplicate detection for chunked processing.
   *
   * Pass 1 — build a complete signatureStore across ALL chunks (no DB writes).
   * Pass 2 — re-evaluate every chunk against the complete store and write scores.
   *
   * This ensures that a page in chunk 1 correctly detects a duplicate in chunk 5.
   *
   * @param {string}   userActivityId
   * @param {string}   userId
   * @param {number}   chunkSize
   * @param {Function} getChunk(skip, limit) → Array<page>
   * @param {Function} onChunkReady(chunk, duplicateResults) → Promise  (called in pass 2)
   * @param {number}   totalCount
   */
  async runTwoPassAnalysis({
    userActivityId,
    userId,
    chunkSize = 2000,
    getChunk,
    onChunkReady,
    totalCount,
  }) {
    logger.info(
      `Two-pass duplicate analysis: ${totalCount} pages, chunk=${chunkSize}`,
      userId,
    );

    // ── Pass 1: build full store ─────────────────────────────────────────────
    logger.info("Duplicate pass 1: building signature store...", userId);
    let signatureStore = this._emptyStore(userActivityId);
    await this._clearRedisStore(signatureStore);

    for (let skip = 0; skip < totalCount; skip += chunkSize) {
      try {
        const chunk = await getChunk(skip, chunkSize);
        if (!chunk.length) break;
        const { updatedStore } = await this._buildStoreOnly(chunk, signatureStore);
        signatureStore = updatedStore;
        logger.debug(
          `Pass 1 — indexed ${Math.min(skip + chunkSize, totalCount)}/${totalCount}`,
          userId,
        );
      } catch (err) {
        logger.error(`Pass 1 chunk at skip=${skip} failed`, err, userId);
      }
    }

    // ── Pass 2: score against complete store ─────────────────────────────────
    logger.info("Duplicate pass 2: scoring against complete store...", userId);

    for (let skip = 0; skip < totalCount; skip += chunkSize) {
      try {
        const chunk = await getChunk(skip, chunkSize);
        if (!chunk.length) break;

        const { duplicateResults } = await this.findDuplicatesWithStore(
          chunk,
          signatureStore,
        );
        await onChunkReady(chunk, duplicateResults);

        logger.debug(
          `Pass 2 — scored ${Math.min(skip + chunkSize, totalCount)}/${totalCount}`,
          userId,
        );
      } catch (err) {
        logger.error(`Pass 2 chunk at skip=${skip} failed`, err, userId);
      }
    }

    logger.info("Two-pass duplicate analysis complete", userId);
  }

  /**
   * Incremental duplicate detection (single pass).
   * Use this only when you want streaming/live results.
   * For batch SEO scoring, prefer runTwoPassAnalysis().
   *
   * @param {Array}  batch          - Array of page objects
   * @param {Object} signatureStore - carry-over store from previous chunk (or null)
   * @returns {Promise<{ duplicateResults: Map, updatedStore: Object }>}
   */
  async findDuplicatesWithStore(batch, signatureStore = null) {
    const store = signatureStore || this._emptyStore(null);
    const duplicateResults = new Map();
    const redis = this._redis(store);
    const prefix = store.userActivityId != null ? this._prefix(store.userActivityId) : null;

    for (const page of batch) {
      try {
        const idStr = page._id.toString();
        const duplicates = {
          titleDuplicates: [],
          descriptionDuplicates: [],
          contentDuplicates: [],
        };

        // ── Skip pages that declare a canonical elsewhere ──────────────────
        if (page.canonicalUrl && page.canonicalUrl !== page.pageUrl) {
          duplicateResults.set(idStr, {
            ...duplicates,
            skippedReason: "has_canonical",
          });
          continue;
        }

        // ── Title ──────────────────────────────────────────────────────────
        const titleNorm =
          page.title?.trim().length > 5 ? this.normalizeTitle(page.title) : "";

        if (titleNorm) {
          let existing = [];
          if (redis) {
            const raw = await redis.hGet(prefix + "titles", titleNorm);
            if (raw) {
              try {
                existing = JSON.parse(raw);
              } catch (_) {
                existing = [];
              }
            }
          } else {
            existing = store.titles.get(titleNorm) || [];
          }

          const others = existing.filter((e) => (e._id || e._idStr)?.toString() !== idStr);

          if (others.length > 0) {
            const raw = others.map((e) => ({
              pageUrl: e.pageUrl,
              title: e.title,
              duplicateType: "exact_match",
              similarity: 1.0,
            }));
            duplicates.titleDuplicates = [
              ...new Map(raw.map((d) => [d.pageUrl, d])).values(),
            ];
            this.stats.titleDuplicatesFound += duplicates.titleDuplicates.length;
          }

          const titleCount = redis
            ? await redis.hLen(prefix + "titles")
            : store.titles.size;
          if (titleCount < STORE_MAX_TITLES) {
            const newEntry = { _id: page._id.toString(), pageUrl: page.pageUrl };
            existing.push(newEntry);
            if (redis) {
              await redis.hSet(prefix + "titles", titleNorm, JSON.stringify(existing));
            } else {
              store.titles.set(titleNorm, existing);
            }
          }
        }

        // ── Meta Description ───────────────────────────────────────────────
        const descNorm =
          page.metaDescription?.trim().length > 10
            ? this.normalizeDescription(page.metaDescription)
            : "";

        if (descNorm) {
          let existing = [];
          if (redis) {
            const raw = await redis.hGet(prefix + "descriptions", descNorm);
            if (raw) {
              try {
                existing = JSON.parse(raw);
              } catch (_) {
                existing = [];
              }
            }
          } else {
            existing = store.descriptions.get(descNorm) || [];
          }

          const others = existing.filter((e) => (e._id || e._idStr)?.toString() !== idStr);

          if (others.length > 0) {
            const raw = others.map((e) => ({
              pageUrl: e.pageUrl,
              description: e.metaDescription,
              duplicateType: "exact_match",
              similarity: 1.0,
            }));
            duplicates.descriptionDuplicates = [
              ...new Map(raw.map((d) => [d.pageUrl, d])).values(),
            ];
            this.stats.descriptionDuplicatesFound +=
              duplicates.descriptionDuplicates.length;
          }

          const descCount = redis
            ? await redis.hLen(prefix + "descriptions")
            : store.descriptions.size;
          if (descCount < STORE_MAX_DESCRIPTIONS) {
            const newEntry = { _id: page._id.toString(), pageUrl: page.pageUrl };
            existing.push(newEntry);
            if (redis) {
              await redis.hSet(prefix + "descriptions", descNorm, JSON.stringify(existing));
            } else {
              store.descriptions.set(descNorm, existing);
            }
          }
        }

        // ── Content (SimHash) ──────────────────────────────────────────────
        if (page.content?.trim().length > 100) {
          const cleanText = this.extractCleanTextFromHtml(page.content);
          const shingles = this.getWordShingles(cleanText, WORD_SHINGLE_SIZE);

          if (shingles.length > 0) {
            const simhash = this.simhashFromWordShingles(shingles);
            const bucketKeys = this.getContentSimhashBucketKeys(simhash);

            const seenIds = new Set();

            for (const key of bucketKeys) {
              let bucket = [];
              if (redis) {
                const bucketKey = prefix + "b:" + key;
                const members = await redis.sMembers(bucketKey);
                bucket = members.map((m) => {
                  try {
                    const o = JSON.parse(m);
                    return {
                      ...o,
                      simhash: BigInt(o.simhash),
                    };
                  } catch (_) {
                    return null;
                  }
                }).filter(Boolean);
              } else {
                bucket = store.contentSimhashBuckets.get(key) || [];
              }

              for (const entry of bucket) {
                const entryIdStr = (entry._id || entry._idStr)?.toString?.() ?? entry._id;
                if (entryIdStr === idStr || seenIds.has(entryIdStr)) continue;
                seenIds.add(entryIdStr);

                const entrySimhash = typeof entry.simhash === "bigint" ? entry.simhash : BigInt(entry.simhash);
                const dist = this.hammingDistance64(simhash, entrySimhash);

                if (dist <= SIMHASH_HAMMING_THRESHOLD) {
                  const similarity = parseFloat((1 - dist / SIMHASH_BITS).toFixed(3));

                  let duplicateType;
                  if (dist === 0) {
                    duplicateType = "exact_match";
                  } else if (dist <= 3) {
                    // This is roughly 95% similarity
                    duplicateType = "near_exact";
                  } else {
                    duplicateType = "near_duplicate"; // Distances 4, 5, 6
                  }

                  duplicates.contentDuplicates.push({
                    pageUrl: entry.pageUrl,
                    wordCount: entry.wordCount || 0,
                    duplicateType,
                    similarity,
                  });
                  this.stats.contentDuplicatesFound += 1;
                }
              }
            }

            duplicates.contentDuplicates = [
              ...new Map(
                duplicates.contentDuplicates.map((d) => [d.pageUrl, d]),
              ).values(),
            ];

            const bucketCount = redis
              ? parseInt(await redis.get(prefix + "bucket_count") || "0", 10)
              : store.totalBucketEntries;
            if (bucketCount < STORE_MAX_BUCKET_ENTRIES) {
              const entryPayload = JSON.stringify({
                simhash: simhash.toString(),
                _id: page._id.toString(),
                pageUrl: page.pageUrl,
                wordCount: page.wordCount || 0,
              });
              if (redis) {
                for (const key of bucketKeys) {
                  await redis.sAdd(prefix + "b:" + key, entryPayload);
                }
                await redis.incrBy(prefix + "bucket_count", 8);
              } else {
                const entry = {
                  simhash,
                  _id: page._id,
                  pageUrl: page.pageUrl,
                  wordCount: page.wordCount || 0,
                };
                for (const key of bucketKeys) {
                  let b = store.contentSimhashBuckets.get(key);
                  if (!b) {
                    b = [];
                    store.contentSimhashBuckets.set(key, b);
                  }
                  b.push(entry);
                  store.totalBucketEntries += 1;
                }
              }
            } else {
              logger.warn(
                `SimHash bucket store limit (${STORE_MAX_BUCKET_ENTRIES}) reached — skipping new entry for ${page.pageUrl}`,
              );
            }
          }
        }

        duplicateResults.set(idStr, duplicates);
      } catch (pageError) {
        logger.error(
          `Duplicate detection failed for page ${page?.pageUrl}:`,
          pageError,
        );
        duplicateResults.set(page._id.toString(), {
          titleDuplicates: [],
          descriptionDuplicates: [],
          contentDuplicates: [],
          error: true,
        });
      }
    }

    return { duplicateResults, updatedStore: store };
  }

  /**
   * Calculate a nuanced SEO duplicate score (0–100).
   * Applies the highest penalty per field (not additive per duplicate).
   */
  calculateDuplicateScore(duplicates) {
    // Skip penalty if page has a canonical declared elsewhere
    if (duplicates.skippedReason === "has_canonical") return 100;

    let penalty = 0;

    // Title — worst duplicate type wins
    if (duplicates.titleDuplicates?.length > 0) {
      const worst = this._worstDuplicateType(duplicates.titleDuplicates);
      penalty +=
        SCORE_PENALTIES.title[worst] ?? SCORE_PENALTIES.title.high_similarity;
    }

    // Description — worst duplicate type wins
    if (duplicates.descriptionDuplicates?.length > 0) {
      const worst = this._worstDuplicateType(duplicates.descriptionDuplicates);
      penalty +=
        SCORE_PENALTIES.description[worst] ??
        SCORE_PENALTIES.description.high_similarity;
    }

    // Content — based on max similarity value
    if (duplicates.contentDuplicates?.length > 0) {
      const maxSimilarity = Math.max(
        ...duplicates.contentDuplicates.map((d) => d.similarity),
      );
      if (maxSimilarity >= 0.99) penalty += SCORE_PENALTIES.content.exact_match;
      else if (maxSimilarity >= 0.85)
        penalty += SCORE_PENALTIES.content.near_exact;
      else penalty += SCORE_PENALTIES.content.high_similarity;
    }

    return Math.max(0, 100 - penalty);
  }

  // ─── Text Extraction & Normalization ────────────────────────────────────────

  extractCleanTextFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    const trimmed = html.trim();
    if (!trimmed.includes("<") || !trimmed.includes(">")) {
      return this.normalizeContent(trimmed);
    }
    try {
      const $ = cheerio.load(trimmed);
      $("nav, footer, header, script, style, noscript, iframe").remove();
      const text = $("body").length ? $("body").text() : $.text();
      return this.normalizeContent(text);
    } catch {
      return this.normalizeContent(trimmed);
    }
  }

  normalizeTitle(title) {
    if (!title) return "";
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s\-]/g, "")
      .substring(0, 200);
  }

  normalizeDescription(description) {
    if (!description) return "";
    return description
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s\-]/g, "")
      .substring(0, 300);
  }

  normalizeContent(content) {
    if (!content) return "";
    return content
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ");
  }

  // ─── SimHash Core ────────────────────────────────────────────────────────────

  getWordShingles(text, k = WORD_SHINGLE_SIZE) {
    if (!text || typeof text !== "string") return [];
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const shingles = [];
    for (let i = 0; i <= words.length - k; i++) {
      shingles.push(words.slice(i, i + k).join(" "));
    }
    return shingles;
  }

  /**
   * 64-bit SimHash from word shingles using Jenkins hash (two hashes per shingle for 64 bits).
   * @param {string[]} shingles
   * @returns {bigint} 64-bit SimHash as BigInt
   */
  simhashFromWordShingles(shingles) {
    if (!shingles?.length) return 0n;
    const jenkins = new Jenkins();
    const hashes = shingles.map((s) => {
      // Jenkins.hash32() returns hex string; parse to 32-bit unsigned for 64-bit combine
      const low = parseInt(jenkins.hash32(s), 16) >>> 0;
      const high = parseInt(jenkins.hash32(s + JENKINS_SALT_HIGH), 16) >>> 0;
      return (BigInt(high) << 32n) | BigInt(low);
    });
    const unique = [...new Set(hashes)].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const selected =
      unique.length > SIMHASH_MAX_FEATURES
        ? unique.slice(0, SIMHASH_MAX_FEATURES)
        : unique;

    let simhash = 0n;
    for (let pos = 0; pos < SIMHASH_BITS; pos++) {
      const mask = 1n << BigInt(pos);
      let weight = 0;
      for (const h of selected) {
        weight += (h & mask) !== 0n ? 1 : -1;
      }
      if (weight > 0) simhash |= mask;
    }
    return simhash;
  }

  /**
   * 8 bands of 8 bits each for 64-bit SimHash LSH bucketing.
   * Keys are bandIndex * 256 + value so bands do not collide.
   * @param {bigint} hash64
   * @returns {number[]} 8 bucket keys
   */
  getContentSimhashBucketKeys(hash64) {
    const keys = [];
    for (let band = 0; band < 8; band++) {
      const shift = BigInt(band * 8);
      const value = Number((hash64 >> shift) & 0xffn);
      keys.push(band * 256 + value);
    }
    return keys;
  }

  /**
   * Hamming distance between two 64-bit SimHashes (BigInt).
   * @param {bigint} a
   * @param {bigint} b
   * @returns {number}
   */
  hammingDistance64(a, b) {
    let x = (a ^ b) & 0xffffffffffffffffn;
    let d = 0;
    while (x !== 0n) {
      d++;
      x &= x - 1n;
    }
    return d;
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  getStats() {
    const total =
      this.stats.titleDuplicatesFound +
      this.stats.descriptionDuplicatesFound +
      this.stats.contentDuplicatesFound;

    return {
      ...this.stats,
      avgDuplicatesPerPage:
        this.stats.webpagesAnalyzed > 0
          ? (total / this.stats.webpagesAnalyzed).toFixed(2)
          : 0,
    };
  }

  resetStats() {
    this.stats = {
      webpagesAnalyzed: 0,
      titleDuplicatesFound: 0,
      descriptionDuplicatesFound: 0,
      contentDuplicatesFound: 0,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Create a signature store. With Redis: { redis, userActivityId }. Without: in-memory Maps.
   * @param {string|null} userActivityId - required when this.redis is set (key prefix dup:{userActivityId}:)
   */
  _emptyStore(userActivityId) {
    if (this.redis) {
      return { redis: this.redis, userActivityId: userActivityId ?? null };
    }
    return {
      titles: new Map(),
      descriptions: new Map(),
      contentSimhashBuckets: new Map(),
      totalBucketEntries: 0,
    };
  }

  /**
   * Clear all Redis keys for this run (prefix dup:{userActivityId}:). No-op if store has no Redis.
   */
  async _clearRedisStore(store) {
    if (!store?.redis || store.userActivityId == null) return;
    const r = store.redis;
    const prefix = this._prefix(store.userActivityId);
    let cursor = "0";
    const keys = [];
    do {
      const result = await r.scan(cursor, "MATCH", prefix + "*", "COUNT", 500);
      const [next, k] = Array.isArray(result) ? result : [result, []];
      cursor = typeof next === "string" ? next : String(next);
      keys.push(...(Array.isArray(k) ? k : [k]));
    } while (cursor !== "0");
    if (keys.length) await r.del(...keys);
  }

  /**
   * Pass 1 helper — index pages into the store without returning duplicateResults.
   * Redis: HSET for titles/descriptions (value = JSON array of { _id, pageUrl } only), SADD for buckets.
   */
  async _buildStoreOnly(batch, signatureStore) {
    const store = signatureStore || this._emptyStore(null);
    const redis = this._redis(store);
    const prefix =
      store.userActivityId != null ? this._prefix(store.userActivityId) : null;

    for (const page of batch) {
      try {
        if (page.canonicalUrl && page.canonicalUrl !== page.pageUrl) continue;

        const titleNorm =
          page.title?.trim().length > 5 ? this.normalizeTitle(page.title) : "";
        if (titleNorm) {
          const titleCount = redis
            ? await redis.hLen(prefix + "titles")
            : store.titles.size;
          if (titleCount < STORE_MAX_TITLES) {
            let existing = [];
            if (redis) {
              const raw = await redis.hGet(prefix + "titles", titleNorm);
              if (raw) {
                try {
                  existing = JSON.parse(raw);
                } catch (_) {
                  existing = [];
                }
              }
              existing.push({ _id: page._id.toString(), pageUrl: page.pageUrl });
              await redis.hSet(
                prefix + "titles",
                titleNorm,
                JSON.stringify(existing),
              );
            } else {
              const existing = store.titles.get(titleNorm) || [];
              existing.push({ _id: page._id, pageUrl: page.pageUrl });
              store.titles.set(titleNorm, existing);
            }
          }
        }

        const descNorm =
          page.metaDescription?.trim().length > 10
            ? this.normalizeDescription(page.metaDescription)
            : "";
        if (descNorm) {
          const descCount = redis
            ? await redis.hLen(prefix + "descriptions")
            : store.descriptions.size;
          if (descCount < STORE_MAX_DESCRIPTIONS) {
            let existing = [];
            if (redis) {
              const raw = await redis.hGet(prefix + "descriptions", descNorm);
              if (raw) {
                try {
                  existing = JSON.parse(raw);
                } catch (_) {
                  existing = [];
                }
              }
              existing.push({ _id: page._id.toString(), pageUrl: page.pageUrl });
              await redis.hSet(
                prefix + "descriptions",
                descNorm,
                JSON.stringify(existing),
              );
            } else {
              const existing = store.descriptions.get(descNorm) || [];
              existing.push({ _id: page._id, pageUrl: page.pageUrl });
              store.descriptions.set(descNorm, existing);
            }
          }
        }

        if (page.content?.trim().length > 100) {
          const cleanText = this.extractCleanTextFromHtml(page.content);
          const shingles = this.getWordShingles(cleanText, WORD_SHINGLE_SIZE);

          const bucketCount = redis
            ? parseInt(await redis.get(prefix + "bucket_count") || "0", 10)
            : store.totalBucketEntries;

          if (
            shingles.length > 0 &&
            bucketCount < STORE_MAX_BUCKET_ENTRIES
          ) {
            const simhash = this.simhashFromWordShingles(shingles);
            const bucketKeys = this.getContentSimhashBucketKeys(simhash);
            const entryPayload = JSON.stringify({
              simhash: simhash.toString(),
              _id: page._id.toString(),
              pageUrl: page.pageUrl,
              wordCount: page.wordCount || 0,
            });

            if (redis) {
              for (const key of bucketKeys) {
                await redis.sAdd(prefix + "b:" + key, entryPayload);
              }
              await redis.incrBy(prefix + "bucket_count", 8);
            } else {
              const entry = {
                simhash,
                _id: page._id,
                pageUrl: page.pageUrl,
                wordCount: page.wordCount || 0,
              };
              for (const key of bucketKeys) {
                let bucket = store.contentSimhashBuckets.get(key);
                if (!bucket) {
                  bucket = [];
                  store.contentSimhashBuckets.set(key, bucket);
                }
                bucket.push(entry);
                store.totalBucketEntries += 1;
              }
            }
          }
        }
      } catch (err) {
        logger.error(`Pass 1 index error for ${page?.pageUrl}:`, err);
        console.error(`Pass 1 index error for ${page?.pageUrl}:`, err);
      }
    }

    return { updatedStore: store };
  }

  /**
   * Returns the single worst duplicate type from a list of duplicate entries.
   */
  _worstDuplicateType(entries) {
    const order = ["exact_match", "near_exact", "high_similarity"];
    for (const type of order) {
      if (entries.some((e) => e.duplicateType === type)) return type;
    }
    return "high_similarity";
  }
}

module.exports = DuplicateProcessorV2;
