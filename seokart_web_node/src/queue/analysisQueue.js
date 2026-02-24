const { Queue } = require("bullmq");
const connection = require("./connection");

const analysisQueue = new Queue("analysisQueue", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
    lockDuration: 2 * 60 * 60 * 1000,
  },
});

module.exports = analysisQueue;
