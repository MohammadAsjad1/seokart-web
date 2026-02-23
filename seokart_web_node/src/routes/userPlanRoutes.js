const express = require('express');
const router = express.Router();
const UserPlanController = require('../controllers/userPlanController');
const { auth } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting middleware
const planUpdateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 plan updates per 15 minutes
  message: {
    success: false,
    message: 'Too many plan update requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const usageUpdateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 usage updates per minute
  message: {
    success: false,
    message: 'Too many usage update requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const domainLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 domain operations per 5 minutes
  message: {
    success: false,
    message: 'Too many domain requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Validation middleware
const validateCreatePlan = (req, res, next) => {
  const userId  = req.user.id;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'User ID is required'
    });
  }

  // Validate ObjectId format
  if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format'
    });
  }

  next();
};

const validateUpdatePlan = (req, res, next) => {
  const  userId = req.user.id;
  const { service, plan } = req.body;

  // Validate user ID
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }

  // Validate service
  const validServices = ['rankTracker', 'webCrawler'];
  if (!service || !validServices.includes(service)) {
    return res.status(400).json({
      success: false,
      message: 'Service is required and must be rankTracker or webCrawler'
    });
  }

  // Validate plan
  const validPlans = {
    rankTracker: ['free', 'basic', 'premium', 'enterprise'],
    webCrawler: ['free', 'basic', 'premium']
  };

  if (!plan || !validPlans[service].includes(plan)) {
    return res.status(400).json({
      success: false,
      message: `Plan is required and must be one of: ${validPlans[service].join(', ')}`
    });
  }

  // Validate billing info if provided
  const { billingInfo } = req.body;
  if (billingInfo) {
    if (billingInfo.amount && (typeof billingInfo.amount !== 'number' || billingInfo.amount < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Billing amount must be a positive number'
      });
    }

    if (billingInfo.status && !['active', 'inactive', 'cancelled', 'trial'].includes(billingInfo.status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid billing status'
      });
    }

    if (billingInfo.endDate && isNaN(Date.parse(billingInfo.endDate))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid end date format'
      });
    }

    if (billingInfo.nextBillingDate && isNaN(Date.parse(billingInfo.nextBillingDate))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid next billing date format'
      });
    }
  }

  next();
};

const validateUsageUpdateReq = (req, res, next) => {
  const  userId = req.user.id;
  const { service, resource, amount, operation } = req.body;

  // Validate user ID
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }

  // Validate service
  const validServices = ['rankTracker', 'webCrawler'];
  if (!service || !validServices.includes(service)) {
    return res.status(400).json({
      success: false,
      message: 'Service is required and must be rankTracker or webCrawler'
    });
  }

  // Validate resource
  const validResources = {
    rankTracker: ['keywords', 'competitors', 'domains', 'updates'],
    webCrawler: ['pages', 'crawls']
  };

  if (!resource || !validResources[service].includes(resource)) {
    return res.status(400).json({
      success: false,
      message: `Resource is required and must be one of: ${validResources[service].join(', ')}`
    });
  }

  // Validate amount
  if (amount !== undefined && (typeof amount !== 'number' || amount < 0)) {
    return res.status(400).json({
      success: false,
      message: 'Amount must be a positive number'
    });
  }

  // Validate operation
  const validOperations = ['increment', 'decrement'];
  if (operation && !validOperations.includes(operation)) {
    return res.status(400).json({
      success: false,
      message: 'Operation must be increment or decrement'
    });
  }

  next();
};

// Domain validation middleware
const validateAddDomain = (req, res, next) => {
  const  userId  = req.user.id;
  const { domain, setAsActive } = req.body;

  // Validate user ID
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }

  // Validate domain
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Domain is required and must be a string'
    });
  }


  // Validate setAsActive if provided
  if (setAsActive !== undefined && typeof setAsActive !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'setAsActive must be a boolean'
    });
  }

  next();
};

const validateSetActiveDomain = (req, res, next) => {
  const  userId = req.user.id;
  const { domain } = req.body;

  // Validate user ID
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }

  // Validate domain
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Domain is required and must be a string'
    });
  }

  next();
};

const validateDomainParam = (req, res, next) => {
  const { domain } = req.params;
  const  userId = req.user.id;

  // Validate user ID
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID'
    });
  }

  // Validate domain
  if (!domain || typeof domain !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Domain is required'
    });
  }

  next();
};

// PUBLIC ROUTES

/**
 * @route   GET /api/plans/info
 * @desc    Get plan information and pricing
 * @access  Public
 */
router.get('/info', UserPlanController.getPlanInfo);

// PROTECTED ROUTES (require authentication)

/**
 * @route   POST /api/plans
 * @desc    Create initial user plan (called after signup)
 * @access  Private
 */
router.post('/', 
  auth, 
  validateCreatePlan, 
  UserPlanController.createUserPlan
);

/**
 * @route   GET /api/plans/:userId
 * @desc    Get user plan details
 * @access  Private
 */
router.get('/', 
  auth, 
  UserPlanController.getUserPlan
);

/**
 * @route   PUT /api/plans/:userId
 * @desc    Update user plan (upgrade/downgrade)
 * @access  Private
 */
router.put('/', 
  auth, 
  planUpdateLimit,
  validateUpdatePlan, 
  UserPlanController.updateUserPlan
);

// DOMAIN MANAGEMENT ROUTES

/**
 * @route   GET /api/plans/:userId/domains
 * @desc    Get user domains
 * @access  Private
 */
router.get('/domains', 
  auth,
  UserPlanController.getUserDomains
);

/**
 * @route   POST /api/plans/:userId/domains
 * @desc    Add domain to user plan
 * @access  Private
 */
router.post('/domains', 
  auth,
  domainLimit,
  validateAddDomain,
  UserPlanController.addDomain
);

/**
 * @route   PUT /api/plans/domains/active
 * @desc    Set active domain
 * @access  Private
 */
router.put('/domains/active', 
  auth,
  domainLimit,
  validateSetActiveDomain,
  UserPlanController.setActiveDomain
);

/**
 * @route   DELETE /api/plans/:userId/domains/:domain
 * @desc    Remove domain from user plan
 * @access  Private
 */
router.delete('/domains/:domain', 
  auth,
  domainLimit,
  validateDomainParam,
  UserPlanController.removeDomain
);

// USAGE AND LIMITS ROUTES

/**
 * @route   POST /api/plans/:userId/usage
 * @desc    Update usage counters
 * @access  Private (internal use)
 */
router.post('/usage', 
  auth,
  usageUpdateLimit,
  validateUsageUpdateReq, 
  UserPlanController.updateUsage
);

/**
 * @route   GET /api/plans/:userId/limits
 * @desc    Check if user can perform specific actions
 * @access  Private
 */
router.get('/limits', 
  auth, 
  UserPlanController.checkLimits
);

// ADMIN ROUTES

/**
 * @route   POST /api/plans/admin/reset-usage
 * @desc    Reset monthly usage for all users (cron job)
 * @access  Admin
 */
router.post('/admin/reset-usage', 
  auth,
  UserPlanController.resetMonthlyUsage
);

/**
 * @route   GET /api/plans/admin/stats
 * @desc    Get plan usage statistics (admin dashboard)
 * @access  Admin
 */
router.get('/admin/stats', 
  auth,
  async (req, res) => {
    try {
      const { UserPlan } = require('../models/userPlan');
      
      // Get plan distribution stats
      const planStats = await UserPlan.aggregate([
        {
          $group: {
            _id: '$rankTracker.plan',
            count: { $sum: 1 },
            totalKeywords: { $sum: '$rankTracker.usage.keywordsUsed' },
            totalCompetitors: { $sum: '$rankTracker.usage.competitorsUsed' },
            totalDomains: { $sum: { $size: '$domains' } }, // Updated to use domains array size
            avgDomainsPerUser: { $avg: { $size: '$domains' } }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      // Get subscription status stats
      const subscriptionStats = await UserPlan.aggregate([
        {
          $group: {
            _id: '$subscription.status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Get domain usage stats
      const domainStats = await UserPlan.aggregate([
        {
          $group: {
            _id: null,
            totalDomains: { $sum: { $size: '$domains' } },
            avgDomainsPerUser: { $avg: { $size: '$domains' } },
            usersWithDomains: { 
              $sum: { 
                $cond: [{ $gt: [{ $size: '$domains' }, 0] }, 1, 0] 
              } 
            },
            maxDomainsPerUser: { $max: { $size: '$domains' } }
          }
        }
      ]);

      // Get active domain stats
      const activeDomainStats = await UserPlan.aggregate([
        {
          $group: {
            _id: null,
            usersWithActiveDomain: { 
              $sum: { 
                $cond: [{ $ne: ['$activeDomain', null] }, 1, 0] 
              } 
            },
            totalUsers: { $sum: 1 }
          }
        }
      ]);

      res.status(200).json({
        success: true,
        data: {
          planDistribution: planStats,
          subscriptionStatus: subscriptionStats,
          domainUsage: domainStats[0] || {
            totalDomains: 0,
            avgDomainsPerUser: 0,
            usersWithDomains: 0,
            maxDomainsPerUser: 0
          },
          activeDomainUsage: activeDomainStats[0] || {
            usersWithActiveDomain: 0,
            totalUsers: 0
          },
          totalUsers: planStats.reduce((sum, stat) => sum + stat.count, 0)
        }
      });

    } catch (error) {
      console.error('Error fetching admin stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/plans/admin/domain-stats
 * @desc    Get detailed domain statistics for admin
 * @access  Admin
 */
router.get('/admin/domain-stats',
  auth,
  async (req, res) => {
    try {
      const { UserPlan } = require('../models/userPlan');
      
      // Get most popular domains
      const popularDomains = await UserPlan.aggregate([
        { $unwind: '$domains' },
        {
          $group: {
            _id: '$domains.domain',
            count: { $sum: 1 },
            activeCount: { 
              $sum: { 
                $cond: ['$domains.isActive', 1, 0] 
              } 
            }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]);

      // Get domain addition trends (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentDomains = await UserPlan.aggregate([
        { $unwind: '$domains' },
        { 
          $match: { 
            'domains.addedAt': { $gte: thirtyDaysAgo } 
          } 
        },
        {
          $group: {
            _id: {
              $dateToString: { 
                format: '%Y-%m-%d', 
                date: '$domains.addedAt' 
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      res.status(200).json({
        success: true,
        data: {
          popularDomains,
          recentDomainAdditions: recentDomains
        }
      });

    } catch (error) {
      console.error('Error fetching domain stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
);

// Error handling middleware for this router
router.use((error, req, res, next) => {
  console.error('UserPlan Route Error:', error);
  
  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }

  // Handle duplicate key errors
  if (error.code === 11000) {
    if (error.keyPattern && error.keyPattern.userId) {
      return res.status(400).json({
        success: false,
        message: 'User plan already exists'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'Duplicate entry'
    });
  }

  // Handle cast errors (invalid ObjectId)
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }

  // Default error
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;