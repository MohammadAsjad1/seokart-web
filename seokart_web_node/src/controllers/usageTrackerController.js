const DataForSeoUsageTracker = require('../config/usageTracker.js');


// Get current month spending for user
async getCurrentMonthSpending(req, res) {
  try {
    const userId = req.user.id;
    
    const spending = await DataForSeoUsageTracker.getCurrentMonthSpending(userId);
    
    res.status(200).json({
      success: true,
      data: {
        currentMonth: new Date().toISOString().slice(0, 7), // YYYY-MM format
        spending: spending.currentMonthSpending,
        apiCalls: spending.currentMonthCalls,
        credits: spending.currentMonthCredits,
        breakdown: spending.breakdown || [],
        lastUpdated: new Date()
      }
    });
  } catch (error) {
    console.error('Error fetching current month spending:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Get detailed usage summary
async getUsageSummary(req, res) {
  try {
    const userId = req.user.id;
    const { 
      startDate, 
      endDate, 
      groupBy = 'month', 
      includeDetails = false 
    } = req.query;

    const options = {
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      groupBy,
      includeDetails: includeDetails === 'true'
    };

    const summary = await DataForSeoUsageTracker.getUserUsageSummary(userId, options);
    
    res.status(200).json({
      success: true,
      data: {
        summary,
        groupBy,
        dateRange: {
          start: options.startDate,
          end: options.endDate
        },
        generatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error fetching usage summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Get monthly usage breakdown
async getMonthlyUsageBreakdown(req, res) {
  try {
    const userId = req.user.id;
    const { month } = req.query; // Format: YYYY-MM
    
    if (!month) {
      return res.status(400).json({
        success: false,
        message: 'Month parameter is required (format: YYYY-MM)'
      });
    }

    const { DataForSeoMonthlySummary } = require('../models/rankTracker'); // Adjust path
    
    const monthlySummary = await DataForSeoMonthlySummary.findOne({
      userId,
      month
    });

    if (!monthlySummary) {
      return res.status(404).json({
        success: false,
        message: 'No usage data found for the specified month'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        month: monthlySummary.month,
        year: monthlySummary.year,
        totals: {
          apiCalls: monthlySummary.totalApiCalls,
          creditsUsed: monthlySummary.totalCreditsUsed,
          dollarsSpent: monthlySummary.totalDollarsSpent,
          successRate: monthlySummary.successRate
        },
        breakdown: {
          byApiType: monthlySummary.usageByApiType,
          byEndpoint: monthlySummary.usageByEndpoint,
          byDay: monthlySummary.dailyUsage
        },
        performance: {
          successfulCalls: monthlySummary.successfulCalls,
          failedCalls: monthlySummary.failedCalls,
          successRate: monthlySummary.successRate
        },
        lastUpdated: monthlySummary.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching monthly usage breakdown:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Get usage trends (last 12 months)
async getUsageTrends(req, res) {
  try {
    const userId = req.user.id;
    
    const { DataForSeoMonthlySummary } = require('../models/rankTracker'); // Adjust path
    
    // Get last 12 months of data
    const monthlyData = await DataForSeoMonthlySummary.find({
      userId
    })
    .sort({ year: -1, month: -1 })
    .limit(12)
    .lean();

    // Calculate trends
    const trends = {
      months: monthlyData.reverse().map(m => ({
        month: m.month,
        year: m.year,
        spending: m.totalDollarsSpent,
        apiCalls: m.totalApiCalls,
        credits: m.totalCreditsUsed,
        successRate: m.successRate
      })),
      totals: {
        totalSpending: monthlyData.reduce((sum, m) => sum + m.totalDollarsSpent, 0),
        totalCalls: monthlyData.reduce((sum, m) => sum + m.totalApiCalls, 0),
        totalCredits: monthlyData.reduce((sum, m) => sum + m.totalCreditsUsed, 0),
        averageSuccessRate: monthlyData.length > 0 
          ? Math.round(monthlyData.reduce((sum, m) => sum + m.successRate, 0) / monthlyData.length * 100) / 100
          : 0
      },
      insights: {
        highestSpendingMonth: monthlyData.reduce((max, m) => 
          m.totalDollarsSpent > (max?.totalDollarsSpent || 0) ? m : max, null),
        lowestSpendingMonth: monthlyData.reduce((min, m) => 
          m.totalDollarsSpent < (min?.totalDollarsSpent || Infinity) ? m : min, null),
        averageMonthlySpending: monthlyData.length > 0 
          ? Math.round(monthlyData.reduce((sum, m) => sum + m.totalDollarsSpent, 0) / monthlyData.length * 100) / 100
          : 0
      }
    };

    res.status(200).json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('Error fetching usage trends:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Get API call details with pagination
async getApiCallDetails(req, res) {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 50, 
      apiType, 
      endpoint, 
      status, 
      startDate, 
      endDate 
    } = req.query;

    const { DataForSeoUsage } = require('../models/rankTracker'); // Adjust path

    // Build query
    const query = { 
      userId,
      ...(apiType && { apiType }),
      ...(endpoint && { apiEndpoint: endpoint }),
      ...(status && { responseStatus: status })
    };

    if (startDate || endDate) {
      query.requestedAt = {};
      if (startDate) query.requestedAt.$gte = new Date(startDate);
      if (endDate) query.requestedAt.$lte = new Date(endDate);
    }

    // Get paginated results
    const apiCalls = await DataForSeoUsage.find(query)
      .sort({ requestedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('keywordId', 'keyword targetDomain')
      .lean();

    const total = await DataForSeoUsage.countDocuments(query);

    // Format response
    const formattedCalls = apiCalls.map(call => ({
      id: call._id,
      taskId: call.taskId,
      endpoint: call.apiEndpoint,
      apiType: call.apiType,
      keyword: call.keywordId?.keyword || call.requestData?.keyword || 'N/A',
      targetDomain: call.keywordId?.targetDomain || call.requestData?.targetDomain || 'N/A',
      cost: {
        credits: call.creditsCost,
        dollars: call.dollarCost
      },
      status: call.responseStatus,
      requestedAt: call.requestedAt,
      completedAt: call.completedAt,
      processingTime: call.completedAt && call.requestedAt 
        ? call.completedAt.getTime() - call.requestedAt.getTime() 
        : null,
      errorMessage: call.errorMessage || null
    }));

    res.status(200).json({
      success: true,
      data: {
        calls: formattedCalls,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        filters: {
          apiType,
          endpoint,
          status,
          dateRange: { startDate, endDate }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching API call details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Get cost analysis and projections
async getCostAnalysis(req, res) {
  try {
    const userId = req.user.id;
    
    // Get current month spending
    const currentMonthSpending = await DataForSeoUsageTracker.getCurrentMonthSpending(userId);
    
    // Get last 3 months for trend analysis
    const { DataForSeoMonthlySummary } = require('../models/rankTracker');
    
    const recentMonths = await DataForSeoMonthlySummary.find({
      userId
    })
    .sort({ year: -1, month: -1 })
    .limit(3)
    .lean();

    // Calculate projections
    const currentMonth = new Date().toISOString().slice(0, 7);
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const daysPassed = new Date().getDate();
    const remainingDays = daysInMonth - daysPassed;
    
    // Project monthly spending based on current rate
    const dailyAverage = currentMonthSpending.currentMonthSpending / daysPassed;
    const projectedMonthlySpending = currentMonthSpending.currentMonthSpending + (dailyAverage * remainingDays);

    // Calculate average from recent months
    const averageMonthlySpending = recentMonths.length > 0 
      ? recentMonths.reduce((sum, m) => sum + m.totalDollarsSpent, 0) / recentMonths.length
      : 0;

    // Cost breakdown by API type
    const costBreakdown = currentMonthSpending.breakdown || [];
    
    // Most expensive operations
    const { DataForSeoUsage } = require('../models/rankTracker');
    
    const expensiveOperations = await DataForSeoUsage.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          billingMonth: currentMonth,
          responseStatus: 'success'
        }
      },
      {
        $group: {
          _id: '$apiEndpoint',
          totalCost: { $sum: '$dollarCost' },
          callCount: { $sum: 1 },
          averageCost: { $avg: '$dollarCost' }
        }
      },
      {
        $sort: { totalCost: -1 }
      },
      {
        $limit: 5
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        currentMonth: {
          month: currentMonth,
          spending: currentMonthSpending.currentMonthSpending,
          calls: currentMonthSpending.currentMonthCalls,
          credits: currentMonthSpending.currentMonthCredits,
          daysPassed,
          remainingDays
        },
        projections: {
          projectedMonthlySpending: Math.round(projectedMonthlySpending * 100) / 100,
          dailyAverage: Math.round(dailyAverage * 100) / 100,
          comparison: {
            vsLastMonth: recentMonths[0] ? projectedMonthlySpending - recentMonths[0].totalDollarsSpent : 0,
            vsAverage: projectedMonthlySpending - averageMonthlySpending
          }
        },
        trends: {
          recentMonths: recentMonths.map(m => ({
            month: m.month,
            spending: m.totalDollarsSpent,
            calls: m.totalApiCalls
          })),
          averageMonthlySpending: Math.round(averageMonthlySpending * 100) / 100
        },
        breakdown: {
          byApiType: costBreakdown,
          expensiveOperations: expensiveOperations.map(op => ({
            endpoint: op._id,
            totalCost: Math.round(op.totalCost * 10000) / 10000,
            callCount: op.callCount,
            averageCost: Math.round(op.averageCost * 10000) / 10000
          }))
        },
        recommendations: this.generateCostRecommendations(
          currentMonthSpending, 
          projectedMonthlySpending, 
          averageMonthlySpending,
          expensiveOperations
        )
      }
    });
  } catch (error) {
    console.error('Error fetching cost analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}

// Helper method to generate cost recommendations
generateCostRecommendations(currentSpending, projected, average, expensiveOps) {
  const recommendations = [];

  // High spending alert
  if (projected > average * 1.5) {
    recommendations.push({
      type: 'warning',
      title: 'High Spending Alert',
      message: `Your projected monthly spending (${projected.toFixed(4)}) is ${Math.round((projected / average - 1) * 100)}% higher than your average.`,
      suggestion: 'Review your API usage patterns and consider optimizing keyword refresh frequency.'
    });
  }

  // Expensive operations
  if (expensiveOps.length > 0 && expensiveOps[0].totalCost > currentSpending.currentMonthSpending * 0.3) {
    recommendations.push({
      type: 'optimization',
      title: 'Cost Optimization Opportunity',
      message: `${expensiveOps[0]._id} accounts for ${Math.round((expensiveOps[0].totalCost / currentSpending.currentMonthSpending) * 100)}% of your spending.`,
      suggestion: 'Consider reducing the frequency of this operation or batching requests more efficiently.'
    });
  }

  // Low usage
  if (currentSpending.currentMonthSpending < average * 0.5 && average > 0) {
    recommendations.push({
      type: 'info',
      title: 'Low Usage Month',
      message: `Your spending this month is ${Math.round((1 - currentSpending.currentMonthSpending / average) * 100)}% lower than average.`,
      suggestion: 'You have room to increase keyword tracking or add more competitors if needed.'
    });
  }

  // No recommendations
  if (recommendations.length === 0) {
    recommendations.push({
      type: 'success',
      title: 'Optimal Usage',
      message: 'Your API usage appears to be within normal parameters.',
      suggestion: 'Continue monitoring your usage patterns for any significant changes.'
    });
  }

  return recommendations;
}

// Initialize pricing data (call this once when your app starts)
async initializePricingData(req, res) {
  try {
    await DataForSeoUsageTracker.initializePricingData();
    
    res.status(200).json({
      success: true,
      message: 'Pricing data initialized successfully'
    });
  } catch (error) {
    console.error('Error initializing pricing data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}