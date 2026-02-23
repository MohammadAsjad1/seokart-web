const express = require('express');
const router = express.Router();
const RankTrackerController = require('../controllers/rankTrackerController');
const { auth } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const RankTrackerService = require("../services/rankTrackerService");
const rankTrackerService = new RankTrackerService();
const mongoose = require('mongoose');

// Rate limiting
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

const refreshLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3,
  message: { success: false, message: 'Too many refresh requests. Please wait.' }
});

// Google Suggestions API rate limiting - more restrictive
const googleSuggestionsLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per user
  message: { success: false, message: 'Too many suggestion requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize controller
const controller = new RankTrackerController();

// Validation middleware
const validateUserId = (req, res, next) => {
  const userId = req.user.id;
  if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID' });
  }
  next();
};

const validateObjectId = (paramName) => (req, res, next) => {
  const id = req.params[paramName];
  if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({ success: false, message: `Invalid ${paramName}` });
  }
  next();
};

const validateDomain = (req, res, next) => {
  const domain = req.body.domain || req.body.targetDomain || req.query.domain || req.query.targetDomain;
  if (domain) {
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain.trim())) {
      return res.status(400).json({ success: false, message: 'Invalid domain format' });
    }
  }
  next();
};

// ========== GOOGLE SUGGESTIONS ROUTE ==========

/**
 * @route   GET /api/custom-rank-tracker/google-suggestions
 * @desc    Get Google autocomplete suggestions for a query
 * @access  Private
 */
router.get('/google-suggestions',
  auth,
  googleSuggestionsLimit,
  validateUserId,
  async (req, res) => {
    try {
      const { query } = req.query;
      
      // Validate query parameter
      if (!query || query.trim().length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Query parameter is required' 
        });
      }
      
      // Validate query length (Google typically limits to ~100 chars)
      if (query.trim().length > 100) {
        return res.status(400).json({ 
          success: false, 
          message: 'Query is too long. Maximum 100 characters allowed.' 
        });
      }
      
      // Sanitize query - remove potentially harmful characters
      const sanitizedQuery = query.trim().replace(/[<>\"']/g, '');
      
      if (sanitizedQuery.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid query after sanitization' 
        });
      }
      
      // Make request to Google Suggest API
      const googleApiUrl = 'https://suggestqueries.google.com/complete/search';
      const params = {
        client: 'firefox',
        q: sanitizedQuery
      };
      
      const response = await axios.get(googleApiUrl, {
        params,
        timeout: 5000, // 5 second timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      // Parse the response - Google returns JSONP format
      let suggestions = [];
      if (response.data && Array.isArray(response.data) && response.data.length > 1) {
        suggestions = response.data[1] || [];
      }
      
      // Filter out empty suggestions and limit results
      const filteredSuggestions = suggestions
        .filter(suggestion => suggestion && suggestion.trim().length > 0)
        .slice(0, 10); // Limit to top 10 suggestions
      
      res.status(200).json({
        success: true,
        data: {
          query: sanitizedQuery,
          suggestions: filteredSuggestions,
          count: filteredSuggestions.length,
          generatedAt: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('Error fetching Google suggestions:', error.message);
      
      // Handle different types of errors
      if (error.code === 'ECONNABORTED') {
        return res.status(408).json({
          success: false,
          message: 'Request timeout. Google suggestions service is not responding.'
        });
      }
      
      if (error.response) {
        // Google API returned an error
        return res.status(503).json({
          success: false,
          message: 'Google suggestions service is temporarily unavailable.'
        });
      }
      
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: 'Unable to connect to Google suggestions service.'
        });
      }
      
      // Generic error
      res.status(500).json({
        success: false,
        message: 'Failed to fetch suggestions. Please try again later.'
      });
    }
  }
);

// ========== KEYWORD MANAGEMENT ROUTES ==========

/**
 * @route   POST /api/custom-rank-tracker/add-keyword
 * @desc    Add new keyword to track
 * @access  Private
 */
router.post('/add-keyword',
  auth,
  generalLimit,
  validateUserId,
  validateDomain,
  (req, res, next) => {
    const { keyword, targetDomain } = req.body;
    
    if (!keyword || keyword.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Keyword is required' });
    }
    
    if (!targetDomain || targetDomain.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Target domain is required' });
    }
    
    next();
  },
  controller.addKeyword.bind(controller)
);

/**
 * @route   DELETE /api/rank-tracker/remove-keyword/:keywordId
 * @desc    Remove keyword from tracking
 * @access  Private
 */
router.delete('/remove-keyword/:keywordId',
  auth,
  validateUserId,
  validateObjectId('keywordId'),
  controller.removeKeyword.bind(controller)
);

router.delete('/bulk-remove-keywords',
  auth,
  validateUserId,
  controller.removeMultipleKeywords.bind(controller)
);

/**
 * @route   GET /api/custom-rank-tracker/keywords
 * @desc    Get all added keywords
 * @access  Private
 */
router.get('/keywords',
  auth,
  validateUserId,
  controller.getAddedKeywords.bind(controller)
);

/**
 * @route   GET /api/custom-rank-tracker/keyword-suggestions
 * @desc    Get keyword suggestions based on target domain and existing keywords
 * @access  Private
 */
router.get('/keyword-suggestions',
  auth,
  validateUserId,
  (req, res, next) => {
    const { targetDomain } = req.query;
    if (!targetDomain) {
      return res.status(400).json({ success: false, message: 'Target domain is required' });
    }
    next();
  },
  controller.getKeywordSuggestions.bind(controller)
);

// ========== COMPETITOR MANAGEMENT ROUTES ==========

/**
 * @route   POST /api/custom-rank-tracker/add-competitor
 * @desc    Add new competitor
 * @access  Private
 */
router.post('/add-competitor',
  auth,
  generalLimit,
  validateUserId,
  (req, res, next) => {
    const { competitors } = req.body;
    
    if (!competitors) {
      return res.status(400).json({ success: false, message: 'Competitors are required' });
    }
    
    next();
  },
  controller.addCompetitor.bind(controller)
);

/**
 * @route   DELETE /api/custom-rank-tracker/remove-competitor/:competitorId
 * @desc    Remove competitor
 * @access  Private
 */
router.delete('/remove-competitor/:competitorId',
  auth,
  validateUserId,
  validateObjectId('competitorId'),
  controller.removeCompetitor.bind(controller)
);

/**
 * @route   GET /api/custom-rank-tracker/competitors
 * @desc    Get all competitors (names only, no ranking data)
 * @access  Private
 */
router.get('/competitors',
  auth,
  validateUserId,
  controller.getAllCompetitors.bind(controller)
);

// ========== DATAFORSEO CALLBACK ROUTES ==========
// These routes handle callbacks from DataForSEO with full results (no task_get needed)
 
/**
 * @route   POST /api/rank-tracker/callback
 * @desc    Handle SERP callback from DataForSEO with full results
 * @access  Public (DataForSEO callback)
 */
router.post('/callback', controller.handleSerpCallback.bind(controller));

/**
 * @route   POST /api/rank-tracker/ai-mode-callback
 * @desc    Handle AI Mode callback from DataForSEO with full results
 * @access  Public (DataForSEO callback)
 */
router.post('/ai-mode-callback', controller.handleAiModeCallback.bind(controller));

// Legacy routes for backward compatibility (if still referenced somewhere)
router.get('/pingback', controller.handlePingbackWebhook.bind(controller));
router.get('/ai-mode-pingback', controller.handleAiModePingbackWebhook.bind(controller));

router.post('/test', 
  controller.testManualKeywordUpdate.bind(controller)
);

router.post('/history', 
  auth,
  controller.getKeywordRankingAnalysis.bind(controller)
);

/**
 * @route   GET /api/custom-rank-tracker/competitor-suggestions
 * @desc    Get competitor suggestions based on domain and keywords
 * @access  Private
 */
router.get('/competitor-suggestions',
  auth,
  validateUserId,
  (req, res, next) => {
    const { targetDomain } = req.query;

    if (!targetDomain) {
      return res.status(400).json({ success: false, message: 'Target domain is required' });
    }
    next();
  },
  controller.getCompetitorSuggestions.bind(controller)
);

/**
 * @route   GET /api/custom-rank-tracker/dashboard-rankings
 * @desc    Get rankings for dashboard (target + competitors for specific keyword)
 * @access  Private
 */
router.get('/dashboard-rankings',
  auth,
  validateUserId,
  (req, res, next) => {
    const { targetDomain } = req.query;
    if (!targetDomain || targetDomain.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Target domain is required' });
    }
    next();
  },
  controller.getDashboardRankings.bind(controller)
);

// ========== REFRESH RANKINGS ROUTES ==========

/**
 * @route   POST /api/custom-rank-tracker/refresh
 * @desc    Manual refresh rankings for keywords
 * @access  Private
 */
router.post('/refresh',
  auth,
  refreshLimit,
  validateUserId,
  (req, res, next) => {
    const { keywordIds } = req.body;
    
    // keywordIds is optional - if not provided, refresh all keywords
    if (keywordIds && (!Array.isArray(keywordIds) || keywordIds.some(id => !id.match(/^[0-9a-fA-F]{24}$/)))) {
      return res.status(400).json({ 
        success: false, 
        message: 'KeywordIds must be an array of valid ObjectIds' 
      });
    }
    
    if (keywordIds && keywordIds.length > 50) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 50 keywords can be refreshed at once' 
      });
    }
    
    next();
  },
  controller.refreshRankings.bind(controller)
);

// ========== BULK OPERATIONS ==========

/**
 * @route   POST /api/custom-rank-tracker/bulk-add-keywords
 * @desc    Bulk add multiple keywords
 * @access  Private
 */
router.post('/bulk-add-keywords',
  auth,
  generalLimit,
  validateUserId,
  (req, res, next) => {
    const { keywords } = req.body;
    
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Keywords array is required' 
      });
    }
    
    if (keywords.length > 20) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 20 keywords can be added at once' 
      });
    }
    
    // Validate each keyword object
    for (const [index, keywordData] of keywords.entries()) {
      if (!keywordData.keyword || !keywordData.targetDomain) {
        return res.status(400).json({ 
          success: false, 
          message: `Keyword and target domain are required for item ${index + 1}` 
        });
      }
      
      const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;
      if (!domainRegex.test(keywordData.targetDomain.trim())) {
        return res.status(400).json({ 
          success: false, 
          message: `Invalid domain format for item ${index + 1}` 
        });
      }
    }
    
    next();
  },
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { keywords } = req.body;
      
      const results = [];
      const errors = [];
      
      for (const keywordData of keywords) {
        try {
          const mockReq = {
            user: { id: userId },
            body: keywordData,
            ip: req.ip,
            get: req.get.bind(req)
          };
          
          const mockRes = {
            status: () => mockRes,
            json: (data) => {
              if (data.success) {
                results.push({
                  keyword: keywordData.keyword,
                  targetDomain: keywordData.targetDomain,
                  success: true,
                  data: data.data
                });
              } else {
                errors.push({
                  keyword: keywordData.keyword,
                  targetDomain: keywordData.targetDomain,
                  error: data.message
                });
              }
            }
          };
          
          await controller.addKeyword(mockReq, mockRes);
        } catch (error) {
          errors.push({
            keyword: keywordData.keyword,
            targetDomain: keywordData.targetDomain,
            error: error.message
          });
        }
      }
      
      res.status(200).json({
        success: true,
        message: 'Bulk keyword operation completed',
        data: {
          successful: results.length,
          failed: errors.length,
          results,
          errors
        }
      });
      
    } catch (error) {
      console.error('Error in bulk keyword addition:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
);

// ========== ANALYTICS & INSIGHTS ==========

/**
 * @route   GET /api/custom-rank-tracker/:userId/keyword-insights
 * @desc    Get keyword performance insights
 * @access  Private
 */
router.get('/:userId/keyword-insights',
  auth,
  validateUserId,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { Keyword } = require('../models/rankTracker');
      
      // Get keyword performance insights
      const insights = await Keyword.aggregate([
        { $match: { userId: new require('mongoose').Types.ObjectId(userId), isActive: true } },
        {
          $group: {
            _id: '$currentRanking.trend',
            count: { $sum: 1 },
            avgPosition: { $avg: '$currentRanking.position' }
          }
        }
      ]);
      
      const totalKeywords = await Keyword.countDocuments({ userId, isActive: true });
      
      res.status(200).json({
        success: true,
        data: {
          totalKeywords,
          trends: insights,
          generatedAt: new Date()
        }
      });
      
    } catch (error) {
      console.error('Error fetching keyword insights:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
);

/**
 * @route   GET /api/custom-rank-tracker/:userId/competitor-insights
 * @desc    Get competitor performance insights
 * @access  Private
 */
router.get('/:userId/competitor-insights',
  auth,
  validateUserId,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { Competitor } = require('../models/rankTracker');
      
      const competitors = await Competitor.find({ userId, isActive: true })
        .select('domain name stats')
        .sort({ 'stats.averagePosition': 1 })
        .lean();
      
      res.status(200).json({
        success: true,
        data: {
          totalCompetitors: competitors.length,
          competitors: competitors.map(c => ({
            domain: c.domain,
            name: c.name,
            averagePosition: c.stats.averagePosition,
            visibilityScore: c.stats.visibilityScore,
            keywordCount: c.stats.keywordCount
          })),
          generatedAt: new Date()
        }
      });
      
    } catch (error) {
      console.error('Error fetching competitor insights:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
);

router.get('/seo-settings', async (req, res) => {
  try {
    const db = mongoose.connection;
    const result = await db.collection('KeywordParams').findOne();

    if (!result) {
      return res.status(404).json({ message: 'SEO settings not found' });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching SEO settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ERROR HANDLING MIDDLEWARE
router.use((error, req, res, next) => {
  console.error('Custom RankTracker Route Error:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;