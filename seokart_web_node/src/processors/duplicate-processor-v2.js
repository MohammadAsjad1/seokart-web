const cheerio = require("cheerio");
const { Jenkins } = require("simhash-js");
const logger = require("../config/logger");

// ─── Constants ────────────────────────────────────────────────────────────────
const SIMHASH_HAMMING_THRESHOLD = 3; // 64-bit: only ~95%+ match (1 - 3/64). Stricter to avoid false duplicates.
const SIMHASH_MAX_FEATURES = 128;
const WORD_SHINGLE_SIZE = 6;
const SIMHASH_BITS = 64;
const JENKINS_SALT_HIGH = "\x01"; // salt for high 32 bits of 64-bit shingle hash

// const BANDS = 4;
// const BITS_PER_BAND = 16;
const BANDS = 8;
const BITS_PER_BAND = 8;

const STORE_MAX_TITLES = 200000;
const STORE_MAX_DESCRIPTIONS = 200000;
const STORE_MAX_BUCKET_ENTRIES = 1000000;
const CONTENT_BUCKET_SAMPLE_SIZE =
  Number(process.env.DUP_BUCKET_SAMPLE_SIZE) || 300;

const REDIS_KEY_PREFIX = "dup";
/** TTL for duplicate-store keys (seconds). Default 24h; set DUP_REDIS_TTL_SECONDS to override. */
const REDIS_TTL_SECONDS = Number(process.env.DUP_REDIS_TTL_SECONDS) || 86400;

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
      sCard: (r.sCard ?? r.scard).bind(r),
      sIsMember: (r.sIsMember ?? r.sismember).bind(r),
      sMembers: (r.sMembers ?? r.smembers).bind(r),
      sRandMember: (r.sRandMember ?? r.srandmember).bind(r),
      get: r.get.bind(r),
      incrBy: (r.incrBy ?? r.incrby).bind(r),
      scan: r.scan.bind(r),
      del: r.del.bind(r),
      expire: (r.expire ?? r.EXPIRE).bind(r),
    };
  }

  /**
   * Execute multiple Redis commands in a single pipeline to reduce round trips.
   * @param {Object} store - signature store with .redis
   * @param {Array<{ cmd: string, args: Array }>} commands - e.g. [{ cmd: 'hGet', args: [key, field] }]
   * @returns {Promise<Array>} results in same order (null on error or missing)
   */
  async _execPipeline(store, commands) {
    if (!store?.redis || !commands.length) return commands.map(() => null);
    const r = store.redis;
    const usePipeline = typeof r.pipeline === "function";
    const multi = usePipeline ? r.pipeline() : r.multi?.();
    if (!multi)
      return Promise.all(
        commands.map(
          (c) =>
            (r[c.cmd] ?? r[c.cmd?.toLowerCase()])?.(...c.args) ??
            Promise.resolve(null),
        ),
      );
    const cmdToMethod = usePipeline
      ? {
          hGet: "hget",
          hSet: "hset",
          hLen: "hlen",
          get: "get",
          sAdd: "sadd",
          sCard: "scard",
          sIsMember: "sismember",
          sMembers: "smembers",
          sRandMember: "srandmember",
          incrBy: "incrby",
          expire: "expire",
        }
      : {
          hGet: "hGet",
          hSet: "hSet",
          hLen: "hLen",
          get: "get",
          sAdd: "sAdd",
          sCard: "sCard",
          sIsMember: "sIsMember",
          sMembers: "sMembers",
          sRandMember: "sRandMember",
          incrBy: "incrBy",
          expire: "expire",
        };
    for (const { cmd, args } of commands) {
      const method =
        cmdToMethod[cmd] ?? (usePipeline ? cmd.toLowerCase() : cmd);
      if (typeof multi[method] === "function") multi[method](...args);
    }
    const results = await (multi.exec
      ? multi.exec()
      : (multi.execAsync?.() ?? Promise.resolve([])));
    if (!Array.isArray(results)) return commands.map(() => null);

    return results.map((res) => {
      // ioredis-style: [err, value]
      if (Array.isArray(res) && res.length === 2) {
        const [err, val] = res;
        return err ? null : val;
      }
      // node-redis v4: value is returned directly
      return res;
    });
  }

  /**
   * Check if Redis duplicate store exists for this activity (e.g. not expired).
   * Used by single-URL crawl to decide whether to reuse store or rebuild from DB.
   * @param {string} userActivityId
   * @returns {Promise<boolean>}
   */
  async isStoreInitialized(userActivityId) {
    if (!this.redis || !userActivityId) return false;
    const store = this._emptyStore(userActivityId);
    const redis = this._redis(store);
    if (!redis) return false;
    const key = this._prefix(userActivityId) + "bucket_count";
    try {
      const v = await redis.get(key);
      return v !== null && v !== undefined;
    } catch (err) {
      logger.debug("isStoreInitialized check failed", {
        userActivityId,
        err: err?.message,
      });
      return false;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Duplicate comparison pass (read-only against existing signature store).
   * This method does not mutate Redis/in-memory store.
   * Build store first with _buildStoreOnly() and then call this for scoring.
   *
   * @param {Array}  batch          - Array of page objects
   * @param {Object} signatureStore - carry-over store from previous chunk (or null)
   * @returns {Promise<{ duplicateResults: Map, updatedStore: Object }>}
   */
  async findDuplicatesWithStore(batch, signatureStore = null) {
    const store = signatureStore || this._emptyStore(null);
    const duplicateResults = new Map();
    const redis = this._redis(store);
    const prefix =
      store.userActivityId != null ? this._prefix(store.userActivityId) : null;

    for (const page of batch) {
      try {
        const idStr = page._id.toString();
        const duplicates = {
          titleDuplicates: [],
          descriptionDuplicates: [],
          contentDuplicates: [],
        };

        if (page.canonicalUrl && page.canonicalUrl !== page.pageUrl) {
          duplicateResults.set(idStr, {
            ...duplicates,
            skippedReason: "has_canonical",
          });
          continue;
        }

        // --- Title & Description Normalization ---
        const titleNorm =
          page.title?.trim().length > 5 ? this.normalizeTitle(page.title) : "";
        const descNorm =
          page.metaDescription?.trim().length > 10
            ? this.normalizeDescription(page.metaDescription)
            : "";

        let titleExisting = [];
        let descExisting = [];

        if (redis) {
          const readCmds = [];
          let titleMembersIdx = -1;
          let descMembersIdx = -1;
          if (titleNorm) {
            titleMembersIdx =
              readCmds.push({
                cmd: "sRandMember",
                args: [prefix + "t:" + titleNorm, CONTENT_BUCKET_SAMPLE_SIZE],
              }) - 1;
          }
          if (descNorm) {
            descMembersIdx =
              readCmds.push({
                cmd: "sRandMember",
                args: [prefix + "d:" + descNorm, CONTENT_BUCKET_SAMPLE_SIZE],
              }) - 1;
          }
          const readResults = await this._execPipeline(store, readCmds);

          const titleMembers =
            titleMembersIdx === -1 ? [] : readResults[titleMembersIdx];
          const titleRows = Array.isArray(titleMembers)
            ? titleMembers
            : titleMembers
              ? [titleMembers]
              : [];
          for (const m of titleRows) {
            try {
              titleExisting.push(JSON.parse(m));
            } catch (_) {}
          }
          const descMembers =
            descMembersIdx === -1 ? [] : readResults[descMembersIdx];
          const descRows = Array.isArray(descMembers)
            ? descMembers
            : descMembers
              ? [descMembers]
              : [];
          for (const m of descRows) {
            try {
              descExisting.push(JSON.parse(m));
            } catch (_) {}
          }
        } else {
          if (titleNorm) titleExisting = store.titles.get(titleNorm) || [];
          if (descNorm) descExisting = store.descriptions.get(descNorm) || [];
        }

        // --- 1. Title Match ---
        if (titleNorm) {
          const others = titleExisting.filter(
            (e) => (e._id || e._idStr)?.toString() !== idStr,
          );
          if (others.length > 0) {
            duplicates.titleDuplicates = others.map((e) => ({
              pageUrl: e.pageUrl,
              title: e.title || "",
              duplicateType: "exact_match",
              similarity: 1.0,
            }));
            this.stats.titleDuplicatesFound +=
              duplicates.titleDuplicates.length;
          }
        }

        // --- 2. Meta Description Match ---
        if (descNorm) {
          const others = descExisting.filter(
            (e) => (e._id || e._idStr)?.toString() !== idStr,
          );
          if (others.length > 0) {
            duplicates.descriptionDuplicates = others.map((e) => ({
              pageUrl: e.pageUrl,
              description: e.metaDescription || e.description || "",
              duplicateType: "exact_match",
              similarity: 1.0,
            }));
            this.stats.descriptionDuplicatesFound +=
              duplicates.descriptionDuplicates.length;
          }
        }

        // --- 3. Content SimHash (4-Band Logic) ---
        let contentBucketMembers = null;

        if (page.content?.trim().length > 100) {
          const cleanText = this.extractCleanTextFromHtml(page.content);
          const shingles = this.getWordShingles(cleanText, WORD_SHINGLE_SIZE);

          if (shingles.length > 0) {
            const simhash = this.simhashFromWordShingles(shingles);
            const bucketKeys = this.getContentSimhashBucketKeys(simhash); // Now returns 4 keys

            if (redis) {
              const contentReadCmds = [
                ...bucketKeys.map((key) => ({
                  cmd: "sRandMember",
                  args: [prefix + "b:" + key, CONTENT_BUCKET_SAMPLE_SIZE],
                })),
              ];
              const contentReadResults = await this._execPipeline(
                store,
                contentReadCmds,
              );
              contentBucketMembers = contentReadResults.slice(0, BANDS);
            }

            const seenIds = new Set();
            for (let i = 0; i < bucketKeys.length; i++) {
              let bucket = [];
              if (redis && contentBucketMembers?.[i]) {
                const members = Array.isArray(contentBucketMembers[i])
                  ? contentBucketMembers[i]
                  : [contentBucketMembers[i]];
                for (const m of members) {
                  try {
                    const o = JSON.parse(m);
                    bucket.push({ ...o, simhash: BigInt(o.simhash) });
                  } catch (_) {}
                }
              } else if (!redis) {
                bucket = store.contentSimhashBuckets.get(bucketKeys[i]) || [];
              }

              for (const entry of bucket) {
                const entryIdStr = (entry._id || entry._idStr)?.toString();
                if (entryIdStr === idStr || seenIds.has(entryIdStr)) continue;
                seenIds.add(entryIdStr);

                const dist = this.hammingDistance64(simhash, entry.simhash);
                if (dist <= SIMHASH_HAMMING_THRESHOLD) {
                  const similarity = parseFloat(
                    (1 - dist / SIMHASH_BITS).toFixed(3),
                  );
                  duplicates.contentDuplicates.push({
                    pageUrl: entry.pageUrl,
                    wordCount: entry.wordCount || 0,
                    duplicateType: dist === 0 ? "exact_match" : "near_exact",
                    similarity,
                  });
                  this.stats.contentDuplicatesFound += 1;
                }
              }
            }
          }
        }

        this.stats.webpagesAnalyzed++;
        duplicateResults.set(idStr, duplicates);
      } catch (err) {
        logger.error(`Error processing ${page?.pageUrl}:`, err);
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
      $(
        "nav, footer, header, aside, script, style, noscript, iframe, svg, form, button",
      ).remove();
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
    const unique = [...new Set(hashes)];
    const selected = unique;
    // unique.length > SIMHASH_MAX_FEATURES
    //   ? unique.slice(0, SIMHASH_MAX_FEATURES)
    //   : unique;

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

  getContentSimhashBucketKeys(hash64) {
    const keys = [];
    for (let band = 0; band < BANDS; band++) {
      const shift = BigInt(band * BITS_PER_BAND);
      // 0xffff is the mask for 16 bits (65535 in decimal)
      const value = Number((hash64 >> shift) & 0xffffn);

      // Offset each band so keys from Band 0 don't collide with Band 1
      // Band 0: 0-65535, Band 1: 65536-131071, etc.
      keys.push(band * 65536 + value);
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
    if (keys.length) {
      const CHUNK = 500;
      for (let i = 0; i < keys.length; i += CHUNK) {
        await r.unlink(...keys.slice(i, i + CHUNK));
      }
    }
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
        const descNorm =
          page.metaDescription?.trim().length > 10
            ? this.normalizeDescription(page.metaDescription)
            : "";

        let titleCount = 0;
        let titleNormExists = false;
        let descCount = 0;
        let descNormExists = false;
        let bucketCount = 0;

        if (redis) {
          const readCmds = [
            { cmd: "sCard", args: [prefix + "title_norms"] },
            { cmd: "sCard", args: [prefix + "description_norms"] },
            { cmd: "get", args: [prefix + "bucket_count"] },
          ];
          let titleExistsIdx = -1;
          let descExistsIdx = -1;
          if (titleNorm) {
            titleExistsIdx =
              readCmds.push({
                cmd: "sIsMember",
                args: [prefix + "title_norms", titleNorm],
              }) - 1;
          }
          if (descNorm) {
            descExistsIdx =
              readCmds.push({
                cmd: "sIsMember",
                args: [prefix + "description_norms", descNorm],
              }) - 1;
          }
          const readResults = await this._execPipeline(store, readCmds);
          titleCount = readResults[0] != null ? Number(readResults[0]) : 0;
          descCount = readResults[1] != null ? Number(readResults[1]) : 0;
          if (titleExistsIdx !== -1)
            titleNormExists = Number(readResults[titleExistsIdx] || 0) === 1;
          if (descExistsIdx !== -1)
            descNormExists = Number(readResults[descExistsIdx] || 0) === 1;
          bucketCount = parseInt(readResults[2] || "0", 10);
        } else {
          titleCount = store.titles.size;
          const titleExisting = titleNorm
            ? store.titles.get(titleNorm) || []
            : [];
          descCount = store.descriptions.size;
          const descExisting = descNorm
            ? store.descriptions.get(descNorm) || []
            : [];
          bucketCount = store.totalBucketEntries;
          if (titleNorm && titleCount < STORE_MAX_TITLES) {
            titleExisting.push({
              _id: page._id.toString(),
              pageUrl: page.pageUrl,
              title: page.title || "",
            });
            store.titles.set(titleNorm, titleExisting);
          }
          if (descNorm && descCount < STORE_MAX_DESCRIPTIONS) {
            descExisting.push({
              _id: page._id.toString(),
              pageUrl: page.pageUrl,
              metaDescription: page.metaDescription || "",
            });
            store.descriptions.set(descNorm, descExisting);
          }
        }

        if (page.content?.trim().length > 100) {
          const cleanText = this.extractCleanTextFromHtml(page.content);
          const shingles = this.getWordShingles(cleanText, WORD_SHINGLE_SIZE);

          if (shingles.length > 0 && bucketCount < STORE_MAX_BUCKET_ENTRIES) {
            const simhash = this.simhashFromWordShingles(shingles);
            const bucketKeys = this.getContentSimhashBucketKeys(simhash);
            const entryPayload = JSON.stringify({
              simhash: simhash.toString(),
              _id: page._id.toString(),
              pageUrl: page.pageUrl,
              wordCount: page.wordCount || 0,
            });

            if (redis) {
              const writeCmds = [];
              for (const key of bucketKeys) {
                writeCmds.push({
                  cmd: "sAdd",
                  args: [prefix + "b:" + key, entryPayload],
                });
                writeCmds.push({
                  cmd: "expire",
                  args: [prefix + "b:" + key, REDIS_TTL_SECONDS],
                });
              }
              writeCmds.push({
                cmd: "incrBy",
                args: [prefix + "bucket_count", BANDS],
              });
              writeCmds.push({
                cmd: "expire",
                args: [prefix + "bucket_count", REDIS_TTL_SECONDS],
              });
              await this._execPipeline(store, writeCmds);
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

        if (redis) {
          const writeCmds = [];
          if (titleNorm && (titleNormExists || titleCount < STORE_MAX_TITLES)) {
            if (!titleNormExists) {
              writeCmds.push({
                cmd: "sAdd",
                args: [prefix + "title_norms", titleNorm],
              });
            }
            writeCmds.push({
              cmd: "sAdd",
              args: [
                prefix + "t:" + titleNorm,
                JSON.stringify({
                  _id: page._id.toString(),
                  pageUrl: page.pageUrl,
                  title: page.title || "",
                }),
              ],
            });
            writeCmds.push({
              cmd: "expire",
              args: [prefix + "title_norms", REDIS_TTL_SECONDS],
            });
            writeCmds.push({
              cmd: "expire",
              args: [prefix + "t:" + titleNorm, REDIS_TTL_SECONDS],
            });
          }
          if (
            descNorm &&
            (descNormExists || descCount < STORE_MAX_DESCRIPTIONS)
          ) {
            if (!descNormExists) {
              writeCmds.push({
                cmd: "sAdd",
                args: [prefix + "description_norms", descNorm],
              });
            }
            writeCmds.push({
              cmd: "sAdd",
              args: [
                prefix + "d:" + descNorm,
                JSON.stringify({
                  _id: page._id.toString(),
                  pageUrl: page.pageUrl,
                  metaDescription: page.metaDescription || "",
                }),
              ],
            });
            writeCmds.push({
              cmd: "expire",
              args: [prefix + "description_norms", REDIS_TTL_SECONDS],
            });
            writeCmds.push({
              cmd: "expire",
              args: [prefix + "d:" + descNorm, REDIS_TTL_SECONDS],
            });
          }
          if (writeCmds.length) await this._execPipeline(store, writeCmds);
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
