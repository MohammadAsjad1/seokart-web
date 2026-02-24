const path = require("path");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");

const worker = new Worker(
  "analysisQueue",
  path.join(__dirname, "analysisProcessor.js"),
  {
    connection,
    concurrency: parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY, 10) || 1,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Analysis job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Analysis job ${job?.id} failed`, err?.message || err);
});

console.log("🚀 Analysis worker started (slow analyzer as background job)");
