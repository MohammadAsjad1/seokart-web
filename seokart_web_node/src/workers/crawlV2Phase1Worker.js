const path = require("path");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");
const crawlV2Config = require("../config/crawl-v2");
const logger = require("../config/logger");

const worker = new Worker(
  "crawlV2Phase1",
  path.join(__dirname, "crawlV2Phase1Processor.js"),
  {
    connection,
    concurrency: crawlV2Config.phase1WorkerConcurrency,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Crawl V2 Phase1 job ${job.id} completed`);
  logger.info(`Crawl V2 Phase1 job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Crawl V2 Phase1 job ${job?.id} failed`, err);
  logger.error(`Crawl V2 Phase1 job ${job?.id} failed`, err);
});

console.log("🚀 Crawl V2 Phase1 worker started");
