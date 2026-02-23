const express = require('express');
const WebScraper = require('../core/scraper');
const router = express.Router();

// Create a single instance of WebScraper to reuse across requests
const scraper = new WebScraper();

// Route for handling proxy rotation requests
router.post('/', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Validate that URL is provided
    if (!url) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'URL is required'
      });
    }

    // Enhanced logging for debugging
    console.log(`[PROXY-ROUTE] Attempting to scrape URL: ${url}`);
    console.log(`[PROXY-ROUTE] Request body:`, req.body);

    // Validate URL format
    try {
      new URL(url);
    } catch (urlError) {
      console.log(`[PROXY-ROUTE] Invalid URL format: ${url}`);
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid URL format',
        url: url
      });
    }

    // Use the instance method to scrape the webpage
    const scrapedData = await scraper.scrapeWebpage(url, {
      timeout: 30000 
    });
    
    console.log(`[PROXY-ROUTE] Successfully scraped URL: ${url}`);
    console.log(`[PROXY-ROUTE] Response status: ${scrapedData.statusCode}`);
    console.log(`[PROXY-ROUTE] Content length: ${scrapedData.content?.length || 0}`);

    // Send the scraped data back as response
    res.status(200).json({
      success: true,
      data: scrapedData
    });

  } catch (error) {
    console.error(`[PROXY-ROUTE] Error scraping URL: ${req.body?.url || 'unknown'}`);
    console.error(`[PROXY-ROUTE] Error details:`, {
      message: error.message,
      code: error.code,
      shouldRetry: error.shouldRetry,
      responseTime: error.responseTime,
      url: req.body?.url
    });
    
    // Handle different types of errors
    if (error.message?.includes('HTTP 404')) {
      // Specific handling for 404 errors
      res.status(404).json({
        error: 'Page Not Found',
        message: `The requested page could not be found: ${error.message}`,
        shouldRetry: false, // Don't retry 404s
        responseTime: error.responseTime,
        url: req.body?.url,
        suggestions: [
          'Check if the URL is correct',
          'Verify the page exists in a browser',
          'Check if the website requires authentication',
          'The website might be blocking automated requests'
        ]
      });
    } else if (error.shouldRetry) {
      res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: error.message,
        shouldRetry: true,
        responseTime: error.responseTime,
        url: req.body?.url
      });
    } else {
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        shouldRetry: false,
        responseTime: error.responseTime || null,
        url: req.body?.url
      });
    }
  }
});



module.exports = router;