const cron = require("node-cron");
const { Keyword, Task, RankTrackerActivity } = require("../models/rankTracker");
const { UserPlan } = require("../models/userPlan");
const RankTrackerService = require("../services/rankTrackerService");

class RankTrackerScheduler {
  constructor() {
    this.rankTrackerService = new RankTrackerService();
    this.isProcessing = false;
    this.taskQueue = [];
    this.maxConcurrentTasks = 10;
    this.currentRunningTasks = 0;
  }

  init() {
    console.log("🚀 Initializing Rank Tracker Scheduler...");

    // this.scheduleTaskProcessor();

    this.scheduleKeywordUpdates();

    this.scheduleDataCleanup();

    this.scheduleMonthlyReset();

    this.scheduleCompetitorStatsUpdate();

    console.log("✅ Rank Tracker Scheduler initialized successfully");
  }

  scheduleTaskProcessor() {
    cron.schedule(
      "*/10 * * * *",
      async () => {
        if (this.isProcessing) {
          console.log("⏳ Task processor already running, skipping...");
          return;
        }

        console.log("🔄 Starting SERP task processing...");
        this.isProcessing = true;

        try {
          const startTime = Date.now();

          const pendingTasks = await Task.find({
            status: "pending",
            $or: [
              { "pingbackInfo.received": false },
              { "pingbackInfo.received": { $exists: false } },
              {
                "pingbackInfo.receivedAt": {
                  $lt: new Date(Date.now() - 30 * 60 * 1000),
                },
              },
            ],
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          }).limit(20);

          const results = [];
          for (const task of pendingTasks) {
            console.log(task)
            try {
              const callbackPayload = {
                tasks: [
                  {
                    id: task,
                    result: [{}], // or actual result data if available
                  },
                ],
              };

              const result =
                await this.rankTrackerService.processSerpCallbackResults(
                  callbackPayload
                );

              if (result) {
                results.push(result);
              }
            } catch (error) {
              console.error(`Failed to process task ${task.taskId}:`, error);
            }
          }

          const endTime = Date.now();
        } catch (error) {
          console.error("❌ Error in task processor:", error);
        } finally {
          this.isProcessing = false;
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log(
      "📅 Task processor scheduled: Every 10 minutes (fallback for pingback)"
    );
  }

  scheduleKeywordUpdates() {
    cron.schedule(
      "0 2 1 * *",
      async () => {
        console.log("🔍 Monthly keyword update check started...");

        try {
          const now = new Date();

          // Get all active keywords that need monthly updates
          const keywordsToUpdate = await Keyword.find({
            isActive: true,
            nextScheduledCheck: { $lte: now },
          });

          if (keywordsToUpdate.length === 0) {
            console.log("✅ No keywords need updates this month");
            return;
          }

          console.log(
            `📊 Found ${keywordsToUpdate.length} keywords for monthly update`
          );

          const userGroups = this.groupKeywordsByUser(keywordsToUpdate);
          let totalTasksCreated = 0;

          for (const [userId, userKeywords] of userGroups) {
            try {
              const userPlan = await UserPlan.findOne({ userId: userId });
              if (!userPlan) {
                console.log(`⚠️ No plan found for user ${userId}, skipping...`);
                continue;
              }

              // Create SERP and AI mode tasks for user's keywords
              for (const keyword of userKeywords) {
                try {
                  await this.rankTrackerService.createSerpTask({
                    keywordId: keyword._id,
                    keyword: keyword.keyword,
                    location: keyword.location,
                    device: keyword.device,
                    targetDomain: keyword.targetDomain,
                    userId: keyword.userId,
                  });

                  // Update next scheduled check to next month
                  await keyword.updateNextScheduledCheck();

                  totalTasksCreated++;
                  await this.delay(200); // Slightly longer delay for monthly batch
                } catch (error) {
                  console.error(
                    `❌ Error creating monthly task for keyword ${keyword._id}:`,
                    error
                  );
                }
              }
            } catch (error) {
              console.error(
                `❌ Error processing monthly keywords for user ${userId}:`,
                error
              );
            }
          }

          console.log(
            `✅ Monthly update completed: ${totalTasksCreated} tasks created`
          );
        } catch (error) {
          console.error("❌ Error in monthly keyword update scheduler:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log(
      "📅 Monthly keyword update scheduler activated: 1st of each month at 2 AM UTC"
    );
  }

  // Daily at 2 AM - Cleanup old data
  scheduleDataCleanup() {
    cron.schedule(
      "0 2 * * *",
      async () => {
        console.log("🧹 Starting daily data cleanup...");

        try {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

          // Cleanup completed tasks older than 30 days
          const tasksDeleted = await Task.deleteMany({
            status: "completed",
            completedAt: { $lt: thirtyDaysAgo },
          });

          // Cleanup failed tasks older than 7 days
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          const failedTasksDeleted = await Task.deleteMany({
            status: "failed",
            createdAt: { $lt: sevenDaysAgo },
          });

          // Cleanup old activity logs (keep only 3 months)
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

          const activitiesDeleted = await RankTrackerActivity.deleteMany({
            timestamp: { $lt: threeMonthsAgo },
          });

          console.log(`✅ Cleanup completed:
          - Deleted ${tasksDeleted.deletedCount} completed tasks
          - Deleted ${failedTasksDeleted.deletedCount} failed tasks  
          - Deleted ${activitiesDeleted.deletedCount} old activities`);

          // Log cleanup activity
          // await RankTrackerActivity.create({
          //   userId: this.systemUserId,
          //   action: 'system_cleanup',
          //   details: {
          //     tasksDeleted: tasksDeleted.deletedCount,
          //     failedTasksDeleted: failedTasksDeleted.deletedCount,
          //     activitiesDeleted: activitiesDeleted.deletedCount
          //   },
          //   metadata: {
          //     source: 'cron',
          //     scheduler: 'dataCleanup'
          //   }
          // });
        } catch (error) {
          console.error("❌ Error in data cleanup:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log("📅 Data cleanup scheduled: Daily at 2 AM UTC");
  }

  // Monthly on 1st at 1 AM - Reset monthly usage counters
  scheduleMonthlyReset() {
    cron.schedule(
      "0 1 1 * *",
      async () => {
        console.log("🔄 Starting monthly usage reset...");

        try {
          const result = await UserPlan.updateMany(
            {},
            {
              $set: {
                "rankTracker.usage.updatesThisMonth": 0,
                "webCrawler.usage.pagesThisMonth": 0,
              },
            }
          );

          console.log(
            `✅ Reset monthly usage for ${result.modifiedCount} users`
          );

          // // Log reset activity
          // await RankTrackerActivity.create({
          //   userId: this.systemUserId,
          //   action: 'monthly_usage_reset',
          //   details: {
          //     usersAffected: result.modifiedCount,
          //     resetDate: new Date()
          //   },
          //   metadata: {
          //     source: 'cron',
          //     scheduler: 'monthlyReset'
          //   }
          // });
        } catch (error) {
          console.error("❌ Error in monthly reset:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log(
      "📅 Monthly usage reset scheduled: 1st of each month at 1 AM UTC"
    );
  }

  // Every 6 hours - Update competitor statistics
  scheduleCompetitorStatsUpdate() {
    cron.schedule(
      "0 */6 * * *",
      async () => {
        console.log("📈 Starting competitor stats update...");

        try {
          const {
            Competitor,
            MonthlyRanking,
          } = require("../models/rankTracker");

          // Get all active competitors
          const competitors = await Competitor.find({ isActive: true });
          let updatedCount = 0;

          for (const competitor of competitors) {
            try {
              // Get all monthly rankings for this competitor
              const rankings = await MonthlyRanking.find({
                userId: competitor.userId,
                domain: competitor.domain,
              });

              if (rankings.length === 0) continue;

              // Calculate stats
              const stats = this.calculateCompetitorStats(rankings);

              // Update competitor stats
              await Competitor.findByIdAndUpdate(competitor._id, {
                "stats.averagePosition": stats.averagePosition,
                "stats.keywordCount": stats.keywordCount,
                "stats.visibilityScore": stats.visibilityScore,
                "stats.positionDistribution": stats.positionDistribution,
                "stats.aiMentions": stats.aiMentions,
                "stats.lastAnalyzed": new Date(),
              });

              updatedCount++;
            } catch (error) {
              console.error(
                `❌ Error updating stats for competitor ${competitor._id}:`,
                error
              );
            }
          }

          console.log(`✅ Updated stats for ${updatedCount} competitors`);
        } catch (error) {
          console.error("❌ Error in competitor stats update:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log("📅 Competitor stats update scheduled: Every 6 hours");
  }

  // Helper method to group keywords by user
  groupKeywordsByUser(keywords) {
    const userGroups = new Map();

    keywords.forEach((keyword) => {
      const userId = keyword.userId._id.toString();

      if (!userGroups.has(userId)) {
        userGroups.set(userId, []);
      }

      userGroups.get(userId).push(keyword);
    });

    return userGroups;
  }

  // Helper method to calculate competitor statistics
  calculateCompetitorStats(rankings) {
    let totalPosition = 0;
    let keywordCount = 0;
    const positionDistribution = {
      top3: 0,
      top10: 0,
      top20: 0,
      top50: 0,
      top100: 0,
    };
    const aiMentions = {
      googleAiOverview: 0,
      googleAiMode: 0,
      chatgpt: 0,
      totalKeywords: rankings.length,
    };

    rankings.forEach((ranking) => {
      if (ranking.currentPosition) {
        totalPosition += ranking.currentPosition;
        keywordCount++;

        // Position distribution
        if (ranking.currentPosition <= 3) positionDistribution.top3++;
        else if (ranking.currentPosition <= 10) positionDistribution.top10++;
        else if (ranking.currentPosition <= 20) positionDistribution.top20++;
        else if (ranking.currentPosition <= 50) positionDistribution.top50++;
        else if (ranking.currentPosition <= 100) positionDistribution.top100++;
      }

      // AI mentions from latest ranking
      if (ranking.rankings && ranking.rankings.length > 0) {
        const latestRanking = ranking.rankings[0];
        if (latestRanking.googleAiOverview) aiMentions.googleAiOverview++;
        if (latestRanking.googleAiMode) aiMentions.googleAiMode++;
        if (latestRanking.chatgptIncluded) aiMentions.chatgpt++;
      }
    });

    const averagePosition =
      keywordCount > 0 ? Math.round(totalPosition / keywordCount) : null;

    // Calculate visibility score (weighted by position)
    const total =
      positionDistribution.top3 +
      positionDistribution.top10 +
      positionDistribution.top20 +
      positionDistribution.top50 +
      positionDistribution.top100;

    let visibilityScore = 0;
    if (total > 0) {
      visibilityScore = Math.round(
        (positionDistribution.top3 * 100 +
          positionDistribution.top10 * 80 +
          positionDistribution.top20 * 60 +
          positionDistribution.top50 * 40 +
          positionDistribution.top100 * 20) /
          total
      );
    }

    return {
      averagePosition,
      keywordCount,
      visibilityScore,
      positionDistribution,
      aiMentions,
    };
  }

  // Helper method to add delay
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Method to manually trigger immediate update for specific user
  async triggerImmediateUpdate(userId, keywordIds = null) {
    try {
      console.log(`🚀 Triggering immediate update for user ${userId}`);

      const query = { userId, isActive: true };
      if (keywordIds && keywordIds.length > 0) {
        query._id = { $in: keywordIds };
      }

      const keywords = await Keyword.find(query);
      let tasksCreated = 0;

      for (const keyword of keywords) {
        try {
          await this.rankTrackerService.createSerpTask({
            keywordId: keyword._id,
            keyword: keyword.keyword,
            location: keyword.location,
            device: keyword.device,
            targetDomain: keyword.targetDomain,
            userId: keyword.userId,
          });

          tasksCreated++;
          await this.delay(100); // Small delay between tasks
        } catch (error) {
          console.error(
            `❌ Error creating immediate task for keyword ${keyword._id}:`,
            error
          );
        }
      }

      console.log(
        `✅ Created ${tasksCreated} immediate tasks for user ${userId}`
      );
      return { success: true, tasksCreated };
    } catch (error) {
      console.error(`❌ Error in immediate update for user ${userId}:`, error);
      throw error;
    }
  }

  // Method to get scheduler status
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      currentRunningTasks: this.currentRunningTasks,
      maxConcurrentTasks: this.maxConcurrentTasks,
      taskQueueLength: this.taskQueue.length,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      schedulers: {
        taskProcessor: "*/10 * * * * (Every 10 minutes)",
        keywordUpdates: "0 * * * * (Every hour)",
        dataCleanup: "0 2 * * * (Daily at 2 AM)",
        monthlyReset: "0 1 1 * * (Monthly on 1st at 1 AM)",
        competitorStats: "0 */6 * * * (Every 6 hours)",
      },
    };
  }

  // Method to stop all schedulers (for graceful shutdown)
  stop() {
    console.log("🛑 Stopping Rank Tracker Scheduler...");
    cron.getTasks().forEach((task) => task.stop());
    console.log("✅ All schedulers stopped");
  }
}

// Create and export singleton instance
const rankTrackerScheduler = new RankTrackerScheduler();

module.exports = rankTrackerScheduler;
