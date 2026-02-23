const logger = require('../config/logger');
const { UserActivity } = require("../models/activity-models");

class ActivityService {
  constructor() {
    // Import your database models
    this.UserActivity = require('../models/activity-models').UserActivity;
  }

  async updateProgress(activityId, progressData) {
    try {
      // ALWAYS UPDATE HEARTBEAT WITH PROGRESS
      const updateData = {
        ...progressData,
        lastHeartbeat: new Date(), // ADD THIS
        lastUpdated: new Date()
      };

      await UserActivity.findByIdAndUpdate(activityId, {
        $set: updateData
      });
    } catch (error) {
      logger.error(`Error updating progress for ${activityId}`, error);
      throw error;
    }
  }

  async updateHeartbeat(activityId) {
    try {
      await UserActivity.findByIdAndUpdate(activityId, {
        $set: {
          lastHeartbeat: new Date()
        }
      });
    } catch (error) {
      logger.error(`Error updating heartbeat for ${activityId}`, error);
    }
  }

  async getActivity(activityId) {
    try {
      return await UserActivity.findById(activityId).lean();
    } catch (error) {
      logger.error(`Error getting activity ${activityId}`, error);
      return null;
    }
  }

  async createActivity(activityData) {
    try {
      const {
        userId,
        websiteUrl,
        status = 'processing',
        startTime = new Date(),
        sitemapUrls = 0,
        progress = 0
      } = activityData;

      // // Check if there's already an active activity for this user and website
      // const existingActivity = await this.UserActivity.findOne({
      //   userId,
      //   websiteUrl,
      //   status: { $in: ['processing', 'analyzing'] }
      // });

      // if (existingActivity) {
      //   throw new Error('An active crawl already exists for this website');
      // }

      // Create new activity
      const activity = new this.UserActivity({
        userId,
        websiteUrl,
        status,
        startTime,
        lastUpdated: new Date(),
        progress,
        isSitemapCrawling: 1,
        isWebpageCrawling: 0,
        isBacklinkFetching: 0,
        sitemapCount: sitemapUrls,
        webpageCount: 0,
        webpagesSuccessful: 0,
        webpagesFailed: 0,
        estimatedTotalUrls: 0,
        estimatedTimeRemaining: 0,
        errorMessages: [],
        crawlCount: 1,
        fastScrapingCompleted: false,
        slowAnalysisCompleted: false
      });

      const savedActivity = await activity.save();
      logger.info(`Created activity ${savedActivity._id} for ${websiteUrl}`, userId);
      
      return savedActivity;

    } catch (error) {
      logger.error('Error creating user activity', error);
      throw error;
    }
  }

   async getUserActivities(userId, options = {}) {
    try {
      const { 
        limit = 20, 
        skip = 0, 
        sort = { lastCrawlStarted: -1 } 
      } = options;

      return await UserActivity.find({ userId })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();
    } catch (error) {
      logger.error(`Error getting activities for user ${userId}`, error);
      return [];
    }
  }


  async getActiveActivity(userId, websiteUrl) {
    try {
      const activity = await this.UserActivity.findOne({
        userId,
        websiteUrl,
        status: { $in: ['processing', 'analyzing'] }
      });
      return activity;
    } catch (error) {
      logger.error('Error fetching active activity', error);
      return null;
    }
  }


  async getWebpagesForUser(userId, websiteUrl, options = {}) {
    try {
      // This would typically join with webpage collections
      // For now, return basic structure
      const activity = await this.UserActivity.findOne({
        userId,
        websiteUrl,
        status: { $in: ['completed', 'completed_with_errors'] }
      }).sort({ startTime: -1 });

      if (!activity) {
        return { webpages: [], pagination: {} };
      }

      // In a real implementation, you'd fetch actual webpage data
      // This is a placeholder showing the expected structure
      return {
        webpages: [],
        pagination: {},
        activitySummary: {
          activityId: activity._id,
          totalWebpages: activity.webpageCount || 0,
          successfulPages: activity.webpagesSuccessful || 0,
          failedPages: activity.webpagesFailed || 0,
          completedAt: activity.endTime,
          processingTime: activity.endTime && activity.startTime ? 
            activity.endTime - activity.startTime : null
        }
      };

    } catch (error) {
      logger.error('Error fetching webpages for user', error);
      return { webpages: [], pagination: {} };
    }
  }

  async markAsCompleted(activityId, success = true, errorMessage = null) {
    try {
      const updateData = {
        status: success ? 'completed' : 'failed',
        endTime: new Date(),
        progress: success ? 100 : 0,
        isSitemapCrawling: 0,
        isWebpageCrawling: 0,
        estimatedTimeRemaining: 0,
        lastUpdated: new Date()
      };

      if (errorMessage) {
        updateData.errorMessages = [errorMessage];
      }

      const activity = await this.UserActivity.findByIdAndUpdate(
        activityId,
        updateData,
        { new: true }
      );

      if (activity) {
        const duration = activity.endTime - activity.startTime;
        logger.info(
          `Activity ${activityId} marked as ${updateData.status} (${duration}ms)`,
          activity.userId
        );
      }

      return activity;

    } catch (error) {
      logger.error(`Error marking activity ${activityId} as completed`, error);
      return null;
    }
  }

  async addErrorMessage(activityId, errorMessage) {
    try {
      const activity = await this.UserActivity.findById(activityId);
      if (activity) {
        activity.errorMessages = activity.errorMessages || [];
        activity.errorMessages.push(errorMessage);
        activity.lastUpdated = new Date();
        
        // Limit error messages to last 10
        if (activity.errorMessages.length > 10) {
          activity.errorMessages = activity.errorMessages.slice(-10);
        }
        
        await activity.save();
      }
      return activity;
    } catch (error) {
      logger.error(`Error adding error message to activity ${activityId}`, error);
      return null;
    }
  }

  async getActivityStats(userId, timeRange = '30d') {
    try {
      const startDate = this.getStartDateForRange(timeRange);
      
      const stats = await this.UserActivity.aggregate([
        {
          $match: {
            userId,
            startTime: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalActivities: { $sum: 1 },
            completedActivities: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            failedActivities: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
            },
            totalWebpages: { $sum: { $ifNull: ['$webpageCount', 0] } },
            totalSuccessfulPages: { $sum: { $ifNull: ['$webpagesSuccessful', 0] } },
            totalFailedPages: { $sum: { $ifNull: ['$webpagesFailed', 0] } },
            avgProcessingTime: {
              $avg: {
                $cond: [
                  { $and: ['$startTime', '$endTime'] },
                  { $subtract: ['$endTime', '$startTime'] },
                  null
                ]
              }
            }
          }
        }
      ]);

      return stats[0] || {
        totalActivities: 0,
        completedActivities: 0,
        failedActivities: 0,
        totalWebpages: 0,
        totalSuccessfulPages: 0,
        totalFailedPages: 0,
        avgProcessingTime: 0
      };

    } catch (error) {
      logger.error('Error fetching activity stats', error);
      return {};
    }
  }

  calculateTimeRemaining(activity, currentProgress) {
    if (!activity.startTime || currentProgress <= 0) {
      return 0;
    }

    const elapsedTime = Date.now() - activity.startTime.getTime();
    const progressRatio = currentProgress / 100;
    
    if (progressRatio >= 1) {
      return 0;
    }

    const estimatedTotalTime = elapsedTime / progressRatio;
    const remainingTime = estimatedTotalTime - elapsedTime;
    
    return Math.max(0, Math.round(remainingTime / 1000)); // Return in seconds
  }

  getStartDateForRange(timeRange) {
    const now = new Date();
    
    switch (timeRange) {
      case '1d':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  // Cleanup old activities (for maintenance)
  async cleanupOldActivities(olderThanDays = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.UserActivity.deleteMany({
        startTime: { $lt: cutoffDate },
        status: { $in: ['completed', 'failed'] }
      });

      logger.info(`Cleaned up ${result.deletedCount} old activities`);
      return result.deletedCount;

    } catch (error) {
      logger.error('Error cleaning up old activities', error);
      return 0;
    }
  }
}

module.exports = ActivityService;