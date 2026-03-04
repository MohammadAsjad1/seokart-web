const path = require("path");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");
const crawlV2Config = require("../config/crawl-v2");

const worker = new Worker(
  "crawlV2Phase2",
  path.join(__dirname, "crawlV2Phase2Processor.js"),
  {
    connection,
    concurrency: crawlV2Config.phase2WorkerConcurrency,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Crawl V2 Phase2 job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Crawl V2 Phase2 job ${job?.id} failed`, err);
});

console.log("🚀 Crawl V2 Phase2 worker started");
