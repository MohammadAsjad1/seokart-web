console.log("SANDBOX FILE LOADED");

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});


const { connect } = require("../config/database");
const { webCrawler } = require("../controllers/scraperController");
const { initEmitter } = require("../services/socket-emitter");

let initialized = false;
/**
 * Scrape processor for the scrape queue
 * @param {Object} job - The job object containing the job data
 * @returns {Object} - The result of the scrape
 * @example
 * const result = await scrapeProcessor(job);
 * console.log(result);
 */
module.exports = async function (job) {
  // Ensure DB + emitter initialized once per child process
  if (!initialized) {
    await connect();
    await initEmitter();
    initialized = true;
    console.log("✅ Sandbox initialized");
  }

  const { websiteUrl, sitemapUrls, userId, concurrency } = job.data;

  console.log(`🔄 Sandbox processing job ${job.id}`);

  console.time("SitemapscrapingTime: ");
  await webCrawler({
    websiteUrl,
    sitemapUrls,
    userId,
    concurrency,
  });
  console.timeEnd("SitemapscrapingTime: ");
  return { success: true };
};
