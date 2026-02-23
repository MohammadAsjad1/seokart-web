
const express = require('express');
const scraperController = require('../controllers/scraperController');
const { auth } = require('../middleware/authMiddleware');
const { handleGetBacklinkSummary } = require('../controllers/scraperController'); 
const router = express.Router();
const logger = require("../config/logger");

const { scraperService } = require("../services/scraper-service");
router.use(auth);

router.post('/scrape', scraperController.handleSitemapCrawl);
router.post('/scrape-url', scraperController.handleSingleUrlCrawl);
router.get('/status/:activityId', scraperController.checkCrawlStatus); 
router.get('/get-activities', scraperController.getUserActivities);


router.post('/stop', scraperController.handleStopCrawl);

module.exports = router;