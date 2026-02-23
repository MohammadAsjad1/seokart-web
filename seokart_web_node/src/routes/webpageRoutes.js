// routes/webpageRoutes.js
const express = require('express');
const router = express.Router();
const { 
  getPaginatedWebpages, 
  getWebpageById, 
  getWebpageStats,
  getErrorWebpages,
  deleteWebsiteActivity
} = require('../controllers/webpageController');
const { auth } = require('../middleware/authMiddleware');

router.use(auth);

router.delete('/activity/:activityId', deleteWebsiteActivity);

// Get paginated webpages for a website
router.get('/:activityId', getPaginatedWebpages);

// Get webpage statistics for a website
router.get('/:websiteUrl/stats', getWebpageStats);

// Get a single webpage by ID
router.get('/detail/:id', getWebpageById);

router.get('/:activityId/errors/:errorType', getErrorWebpages);

module.exports = router;