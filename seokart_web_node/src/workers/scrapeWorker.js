const path = require("path");
const { pathToFileURL } = require("url");
const { Worker } = require("bullmq");
const connection = require("../queue/connection");

const processorPath = path.join(__dirname, "workers-processor", "scrapeProcessor.js");
const worker = new Worker(
  "scrapeQueue",
  pathToFileURL(processorPath), 
  {
    connection,
    concurrency: parseInt(process.env.SCRAPER_WORKER_CONCURRENCY, 10) || 1, // creates 1 sandbox process
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