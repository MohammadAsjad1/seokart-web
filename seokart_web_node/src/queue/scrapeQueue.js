const { Queue } = require("bullmq");
const connection = require("./connection");

const scrapeQueue = new Queue("scrapeQueue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    lockDuration: 2 * 60 * 60 * 1000,
  },
});

module.exports = scrapeQueue;
