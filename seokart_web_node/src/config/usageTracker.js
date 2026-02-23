const { DataForSeoUsage, DataForSeoMonthlySummary, DataForSeoPricing } = require('../models/dataForSeoPricing');
const mongoose = require('mongoose');

class DataForSeoUsageTracker {
  
  // In-memory cache for pricing to avoid repeated DB calls
  static pricingCache = new Map();
  static cacheExpiry = 60 * 60 * 1000; // 1 hour
  static lastCacheUpdate = 0;
  static isInitializing = false; // Prevent multiple simultaneous initializations

  // Check if mongoose is connected
  static isMongooseConnected() {
    return mongoose.connection.readyState === 1;
  }

  // Wait for mongoose connection
  static async waitForConnection(maxWaitTime = 10000) {
    if (this.isMongooseConnected()) {
      return true;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkConnection = () => {
        if (this.isMongooseConnected()) {
          resolve(true);
        } else if (Date.now() - startTime >= maxWaitTime) {
          console.warn('⚠️  Timeout waiting for MongoDB connection');
          resolve(false);
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      
      checkConnection();
    });
  }

  // Initialize pricing cache with connection check
  static async initializePricingCache() {
    // Prevent multiple simultaneous initializations
    if (this.isInitializing) {
      console.log('⏳ Pricing cache initialization already in progress...');
      return;
    }

    try {
      this.isInitializing = true;

      // Wait for MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot initialize pricing cache: MongoDB not connected');
        return;
      }

      const pricingData = await DataForSeoPricing.find({ isActive: true });
      this.pricingCache.clear();
      
      pricingData.forEach(pricing => {
        this.pricingCache.set(pricing.endpoint, {
          dollarsPerRequest: pricing.dollarsPerRequest,
          apiType: pricing.apiType,
          creditsPerRequest: pricing.creditsPerRequest,
          dollarsPerCredit: pricing.dollarsPerCredit
        });
      });
      
      this.lastCacheUpdate = Date.now();
      console.log(`✅ Pricing cache initialized with ${pricingData.length} endpoints`);
    } catch (error) {
      console.error('❌ Error initializing pricing cache:', error);
      // Clear cache on error to force retry
      this.pricingCache.clear();
      this.lastCacheUpdate = 0;
    } finally {
      this.isInitializing = false;
    }
  }

  // Get pricing from cache with auto-refresh and connection check
  static async getPricing(endpoint) {
    // Check if cache needs refresh
    const needsRefresh = this.pricingCache.size === 0 || 
                        (Date.now() - this.lastCacheUpdate) > this.cacheExpiry;
    
    if (needsRefresh && !this.isInitializing) {
      await this.initializePricingCache();
    }

    return this.pricingCache.get(endpoint);
  }

  // Track API usage when making a request (BEFORE the API call)
  static async trackApiCall(params) {
    const {
      taskId,
      userId,
      keywordId,
      endpoint,
      requestData,
      apiType
    } = params;

    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot track API call: MongoDB not connected');
        return null;
      }

      // Get pricing from cache
      const pricing = await this.getPricing(endpoint);
      if (!pricing) {
        console.warn(`⚠️  No pricing found for endpoint: ${endpoint}`);
        return null;
      }

      // Simple calculation - just use dollarsPerRequest directly
      const dollarCost = pricing.dollarsPerRequest;
      const creditsCost = pricing.creditsPerRequest || Math.ceil(dollarCost / pricing.dollarsPerCredit);

      // Create usage record
      const usageRecord = new DataForSeoUsage({
        taskId,
        userId,
        keywordId,
        apiEndpoint: endpoint,
        apiType: apiType || pricing.apiType,
        creditsCost,
        dollarCost,
        requestData: {
          keyword: requestData.keyword,
          location: requestData.location,
          language: requestData.language,
          device: requestData.device,
          targetDomain: requestData.targetDomain,
          depth: requestData.depth,
          limit: requestData.limit,
          includeAiTracking: requestData.includeAiTracking,
          additionalParams: requestData.additionalParams || {}
        },
        responseStatus: 'pending'
      });

      await usageRecord.save();
      console.log(`💰 Tracked API call: ${endpoint} - $${dollarCost.toFixed(6)} (${creditsCost} credits) - Task: ${taskId}`);
      
      return usageRecord;
    } catch (error) {
      console.error('❌ Error tracking API call:', error);
      return null;
    }
  }

  // Update usage record when API response is received
  static async updateApiCallResult(taskId, responseData, status = 'success', errorInfo = null) {
    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot update API call result: MongoDB not connected');
        return null;
      }

      const updateData = {
        responseStatus: status,
        completedAt: new Date()
      };

      // Only update responseData if provided
      if (responseData) {
        updateData.responseData = {
          totalResults: responseData.totalResults,
          itemsCount: responseData.itemsCount,
          processingTime: responseData.processingTime,
          serpFeatures: responseData.serpFeatures,
          cost: responseData.cost,
          statusCode: responseData.statusCode,
          additionalMetrics: responseData.additionalMetrics || {}
        };
      }

      if (errorInfo) {
        updateData.errorMessage = errorInfo.message;
        updateData.errorCode = errorInfo.code;
      }

      const updatedRecord = await DataForSeoUsage.findOneAndUpdate(
        { taskId },
        updateData,
        { new: true }
      );

      if (updatedRecord && status === 'success' && updatedRecord.userId) {
        // Update monthly summary only for successful calls
        await this.updateMonthlySummary(updatedRecord.userId, updatedRecord.billingMonth);
      }

      if (updatedRecord) {
        console.log(`📊 Updated API result: ${taskId} - Status: ${status}`);
      }

      return updatedRecord;
    } catch (error) {
      console.error('❌ Error updating API call result:', error);
      return null;
    }
  }

  // Update monthly summary - optimized to avoid loops
  static async updateMonthlySummary(userId, billingMonth) {
    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot update monthly summary: MongoDB not connected');
        return null;
      }

      const objectId = new mongoose.Types.ObjectId(userId);
      
      // Single aggregation query to get all monthly data
      const monthlyData = await DataForSeoUsage.aggregate([
        {
          $match: {
            userId: objectId,
            billingMonth,
            responseStatus: 'success'
          }
        },
        {
          $group: {
            _id: null,
            totalApiCalls: { $sum: 1 },
            totalCreditsUsed: { $sum: '$creditsCost' },
            totalDollarsSpent: { $sum: '$dollarCost' },
            successfulCalls: { $sum: 1 },
            
            // Group by API type
            apiTypeStats: {
              $push: {
                apiType: '$apiType',
                credits: '$creditsCost',
                dollars: '$dollarCost'
              }
            },
            
            // Group by endpoint
            endpointStats: {
              $push: {
                endpoint: '$apiEndpoint',
                credits: '$creditsCost',
                dollars: '$dollarCost'
              }
            },
            
            // Group by date
            dailyStats: {
              $push: {
                date: '$billingDate',
                credits: '$creditsCost',
                dollars: '$dollarCost'
              }
            }
          }
        }
      ]);

      if (monthlyData.length === 0) {
        console.log(`ℹ️  No data found for user ${userId} in ${billingMonth}`);
        return;
      }

      const data = monthlyData[0];
      
      // Process breakdowns using Map for better performance
      const apiTypeMap = new Map();
      const endpointMap = new Map();
      const dailyMap = new Map();

      // Process API type breakdown
      data.apiTypeStats.forEach(item => {
        if (!apiTypeMap.has(item.apiType)) {
          apiTypeMap.set(item.apiType, { apiCalls: 0, creditsUsed: 0, dollarsSpent: 0 });
        }
        const stats = apiTypeMap.get(item.apiType);
        stats.apiCalls += 1;
        stats.creditsUsed += item.credits;
        stats.dollarsSpent += item.dollars;
      });

      // Process endpoint breakdown
      data.endpointStats.forEach(item => {
        if (!endpointMap.has(item.endpoint)) {
          endpointMap.set(item.endpoint, { apiCalls: 0, creditsUsed: 0, dollarsSpent: 0 });
        }
        const stats = endpointMap.get(item.endpoint);
        stats.apiCalls += 1;
        stats.creditsUsed += item.credits;
        stats.dollarsSpent += item.dollars;
      });

      // Process daily breakdown
      data.dailyStats.forEach(item => {
        if (!dailyMap.has(item.date)) {
          dailyMap.set(item.date, { apiCalls: 0, creditsUsed: 0, dollarsSpent: 0 });
        }
        const stats = dailyMap.get(item.date);
        stats.apiCalls += 1;
        stats.creditsUsed += item.credits;
        stats.dollarsSpent += item.dollars;
      });

      // Convert Maps to arrays
      const usageByApiType = Array.from(apiTypeMap.entries()).map(([apiType, stats]) => ({
        apiType,
        ...stats
      }));

      const usageByEndpoint = Array.from(endpointMap.entries()).map(([endpoint, stats]) => ({
        endpoint,
        ...stats
      }));

      const dailyUsage = Array.from(dailyMap.entries()).map(([date, stats]) => ({
        date,
        ...stats
      }));

      // Get failed calls count
      const failedCallsData = await DataForSeoUsage.countDocuments({
        userId: objectId,
        billingMonth,
        responseStatus: 'failed'
      });

      const totalCalls = data.successfulCalls + failedCallsData;
      const successRate = totalCalls > 0 ? Math.round((data.successfulCalls / totalCalls) * 10000) / 100 : 0;

      // Extract year from billingMonth
      const [year] = billingMonth.split('-').map(Number);

      // Upsert monthly summary
      const summary = await DataForSeoMonthlySummary.findOneAndUpdate(
        { userId: objectId, month: billingMonth },
        {
          year,
          totalApiCalls: data.totalApiCalls,
          totalCreditsUsed: data.totalCreditsUsed,
          totalDollarsSpent: data.totalDollarsSpent,
          usageByApiType,
          usageByEndpoint,
          dailyUsage,
          successfulCalls: data.successfulCalls,
          failedCalls: failedCallsData,
          successRate,
          updatedAt: new Date()
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );

      console.log(`📊 Updated monthly summary for ${userId} - ${billingMonth}: $${data.totalDollarsSpent.toFixed(6)} (${data.totalApiCalls} calls)`);
      return summary;
    } catch (error) {
      console.error('❌ Error updating monthly summary:', error);
    }
  }

  // Get usage summary for a user - simplified and optimized
  static async getUserUsageSummary(userId, options = {}) {
    const { 
      startDate, 
      endDate, 
      groupBy = 'month'
    } = options;

    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot get usage summary: MongoDB not connected');
        return [];
      }

      const objectId = new mongoose.Types.ObjectId(userId);
      let matchConditions = { 
        userId: objectId,
        responseStatus: 'success'
      };

      if (startDate || endDate) {
        matchConditions.requestedAt = {};
        if (startDate) matchConditions.requestedAt.$gte = new Date(startDate);
        if (endDate) matchConditions.requestedAt.$lte = new Date(endDate);
      }

      let groupField;
      switch (groupBy) {
        case 'day':
          groupField = '$billingDate';
          break;
        case 'month':
          groupField = '$billingMonth';
          break;
        case 'year':
          groupField = { $year: '$requestedAt' };
          break;
        default:
          groupField = '$billingMonth';
      }

      const results = await DataForSeoUsage.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: groupField,
            totalApiCalls: { $sum: 1 },
            totalCreditsUsed: { $sum: '$creditsCost' },
            totalDollarsSpent: { $sum: '$dollarCost' },
            uniqueApiTypes: { $addToSet: '$apiType' },
            uniqueEndpoints: { $addToSet: '$apiEndpoint' }
          }
        },
        { $sort: { _id: -1 } },
        { $limit: 50 } // Limit results to avoid memory issues
      ]);

      return results;
    } catch (error) {
      console.error('❌ Error getting usage summary:', error);
      return [];
    }
  }

  // Get real-time spending for current month - cached for performance
  static async getCurrentMonthSpending(userId) {
    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot get current month spending: MongoDB not connected');
        return {
          currentMonthSpending: 0,
          currentMonthCalls: 0,
          currentMonthCredits: 0,
          breakdown: []
        };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const objectId = new mongoose.Types.ObjectId(userId);

      const summary = await DataForSeoMonthlySummary.findOne({
        userId: objectId,
        month: currentMonth
      });

      if (!summary) {
        return {
          currentMonthSpending: 0,
          currentMonthCalls: 0,
          currentMonthCredits: 0,
          breakdown: []
        };
      }

      return {
        currentMonthSpending: summary.totalDollarsSpent,
        currentMonthCalls: summary.totalApiCalls,
        currentMonthCredits: summary.totalCreditsUsed,
        breakdown: summary.usageByApiType || []
      };
    } catch (error) {
      console.error('❌ Error getting current month spending:', error);
      return {
        currentMonthSpending: 0,
        currentMonthCalls: 0,
        currentMonthCredits: 0,
        breakdown: []
      };
    }
  }

  // Get detailed usage for a specific period
  static async getDetailedUsage(userId, options = {}) {
    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot get detailed usage: MongoDB not connected');
        return { usage: [], total: 0, hasMore: false };
      }

      const {
        startDate,
        endDate,
        endpoint,
        apiType,
        status = 'success',
        limit = 100,
        skip = 0
      } = options;

      const objectId = new mongoose.Types.ObjectId(userId);
      let matchConditions = { 
        userId: objectId,
        responseStatus: status
      };

      if (startDate || endDate) {
        matchConditions.requestedAt = {};
        if (startDate) matchConditions.requestedAt.$gte = new Date(startDate);
        if (endDate) matchConditions.requestedAt.$lte = new Date(endDate);
      }

      if (endpoint) matchConditions.apiEndpoint = endpoint;
      if (apiType) matchConditions.apiType = apiType;

      const usage = await DataForSeoUsage.find(matchConditions)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('taskId apiEndpoint apiType creditsCost dollarCost requestData responseData requestedAt completedAt responseStatus errorMessage');

      const total = await DataForSeoUsage.countDocuments(matchConditions);

      return {
        usage,
        total,
        hasMore: (skip + limit) < total
      };
    } catch (error) {
      console.error('❌ Error getting detailed usage:', error);
      return { usage: [], total: 0, hasMore: false };
    }
  }

  // Clean up old usage records (optional - for data retention)
  static async cleanupOldRecords(daysToKeep = 90) {
    try {
      // Ensure MongoDB connection
      const isConnected = await this.waitForConnection();
      if (!isConnected) {
        console.error('❌ Cannot cleanup old records: MongoDB not connected');
        return 0;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await DataForSeoUsage.deleteMany({
        requestedAt: { $lt: cutoffDate },
        responseStatus: { $in: ['success', 'failed'] }
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old usage records`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old records:', error);
      return 0;
    }
  }

  // Initialize the tracker (call this after MongoDB connection is established)
  static async initialize() {
    console.log('🚀 Initializing DataForSeo Usage Tracker...');
    await this.initializePricingCache();
  }
}

module.exports = DataForSeoUsageTracker;