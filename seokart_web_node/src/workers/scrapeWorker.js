const path = require("path");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");
const worker = new Worker(
  "scrapeQueue",
  path.join(__dirname, "scrapeProcessor.js"), 
  {
    connection,
    concurrency: 2, // creates 1 sandbox process
    maxStalledCount: 3,
  }
);

// concurrency is the number of jobs that can be processed at the same time
// maxStalledCount ->  if the job is stalled for 3 times, then the job will be failed otherwise it will be processed again

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed`, err);
});

console.log("🚀 Sandboxed worker started");