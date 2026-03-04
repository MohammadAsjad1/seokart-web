const { Queue } = require("bullmq");
const connection = require("./connection");
const crawlV2Config = require("../config/crawl-v2");

const crawlV2Phase1Queue = new Queue("crawlV2Phase1", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: { count: 1000 },
    lockDuration: crawlV2Config.phase1LockDurationMs,
  },
});

module.exports = crawlV2Phase1Queue;
