const express = require('express');
const router = express.Router();
const controller = require('../controllers/usageTrackerController');
const { auth } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

// Add usage analytics routes
router.get('/usage/current-month', auth, controller.getCurrentMonthSpending);
router.get('/usage/summary', auth, controller.getUsageSummary);
router.get('/usage/monthly/:month', auth, controller.getMonthlyUsageBreakdown);
router.get('/usage/trends', auth, controller.getUsageTrends);
router.get('/usage/calls', auth, controller.getApiCallDetails);
router.get('/usage/cost-analysis', auth, controller.getCostAnalysis);

// One-time setup route (run once)
router.post('/admin/initialize-pricing', auth, controller.initializePricingData);