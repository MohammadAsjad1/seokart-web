// routes/webpageRoutes.js
const express = require('express');
const router = express.Router();
const {
  getPaginatedWebpages,
  getWebpageById,
  getWebpageStats,
  getErrorWebpages,
  deleteWebsiteActivity,  
  getWebPageError
} = require('../controllers/webpageController');
const { auth } = require('../middleware/authMiddleware');

router.use(auth);

router.delete('/activity/:activityId', deleteWebsiteActivity);

// Get paginated webpages for a website
router.get('/pages/:activityId', getPaginatedWebpages);

// Fetch Page Errors
router.get('/errors/:activityId', getWebPageError);

// Get webpage statistics for a website
router.get('/:websiteUrl/stats', getWebpageStats);

// Get a single webpage by ID
router.get('/detail/:id', getWebpageById);

router.get('/:activityId/errors/:errorType', getErrorWebpages);

module.exports = router;