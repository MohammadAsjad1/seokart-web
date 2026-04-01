const cron = require("node-cron");
const BacklinkSummary = require("../models/BacklinkSummary");
const { fetchAndUpdateBacklinkData } = require("../services/backlinkService");

class BacklinkScheduler {
  constructor() {
    this.isProcessing = false;
    this.monthlySyncTask = null;
    this.syncConcurrency = Math.max(
      1,
      parseInt(process.env.BACKLINK_SYNC_CONCURRENCY, 10) || 5,
    );
    this.logEvery = Math.max(
      50,
      parseInt(process.env.BACKLINK_SYNC_LOG_EVERY, 10) || 200,
    );
  }

  init() {
    console.log("🚀 Initializing Backlink Scheduler...");
    this.scheduleMonthlyBacklinkSync();
    console.log("✅ Backlink Scheduler initialized successfully");
  }

  scheduleMonthlyBacklinkSync() {
    this.monthlySyncTask = cron.schedule(
      "0 1 1 * *",
      async () => {
        if (this.isProcessing) {
          console.log("⏳ Backlink monthly sync already running, skipping...");
          return;
        }

        this.isProcessing = true;
        console.log("🔄 Starting monthly backlink sync...");

        try {
          const query = { websiteUrl: { $exists: true, $ne: "" } };
          const totalWebsites = await BacklinkSummary.countDocuments(query);

          if (!totalWebsites) {
            console.log("✅ No websites found for monthly backlink sync");
            return;
          }

          let successCount = 0;
          let failureCount = 0;
          let processedCount = 0;
          const inFlight = new Set();

          console.log(
            `📊 Monthly backlink sync started for ${totalWebsites} websites (concurrency: ${this.syncConcurrency})`,
          );

          const runSync = async (item) => {
            try {
              const result = await fetchAndUpdateBacklinkData(
                item.userId,
                item.websiteUrl,
              );

              if (result.success) {
                successCount++;
              } else {
                failureCount++;
                console.error(
                  `❌ Monthly backlink sync failed for ${item.websiteUrl}: ${result.error || "Unknown error"}`,
                );
              }
            } catch (error) {
              failureCount++;
              console.error(
                `❌ Monthly backlink sync crashed for ${item.websiteUrl}:`,
                error.message,
              );
            } finally {
              processedCount++;
              if (
                processedCount % this.logEvery === 0 ||
                processedCount === totalWebsites
              ) {
                console.log(
                  `📈 Backlink sync progress ${processedCount}/${totalWebsites} (success: ${successCount}, failed: ${failureCount})`,
                );
              }
            }
          };

          const cursor = BacklinkSummary.find(query)
            .select("userId websiteUrl")
            .lean()
            .cursor();

          for await (const item of cursor) {
            const task = runSync(item).finally(() => inFlight.delete(task));
            inFlight.add(task);

            if (inFlight.size >= this.syncConcurrency) {
              await Promise.race(inFlight);
            }
          }

          await Promise.all(inFlight);

          console.log(
            `✅ Monthly backlink sync finished. Success: ${successCount}, Failed: ${failureCount}, Total: ${totalWebsites}`,
          );
        } catch (error) {
          console.error("❌ Error in monthly backlink scheduler:", error);
        } finally {
          this.isProcessing = false;
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      },
    );

    console.log(
      "📅 Backlink monthly sync scheduled: 1st of each month at 3 AM UTC",
    );
  }

  stop() {
    console.log("🛑 Stopping Backlink Scheduler...");
    if (this.monthlySyncTask) {
      this.monthlySyncTask.stop();
    }
    console.log("✅ Backlink Scheduler stopped");
  }
}

const backlinkScheduler = new BacklinkScheduler();

module.exports = backlinkScheduler;
