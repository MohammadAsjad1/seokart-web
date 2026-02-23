const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");
const { OAuth2Client } = require('google-auth-library');
const { UserPlan } = require('../models/userPlan');
const RankTrackerService = require("../services/rankTrackerService");
const { webCrawler } = require("../controllers/scraperController.js");
const rankTrackerService = new RankTrackerService();
const backlinkService = require("../services/backlinkService");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const {
  Keyword,
  Competitor,
  MonthlyRanking,
  SerpSnapshot,
  RankTrackerActivity,
  KeywordSuggestion,
  CompetitorSuggestion,
} = require("../models/rankTracker");
const scrapeQueue = require("../queue/scrapeQueue.js");


const extractKeywordsFromDomain = (domain) => {
  const blacklist = ["www", "com", "in", "net", "org", "info", "co", "io"];

  let cleanDomain = domain.replace(/^https?:\/\//, "");

  cleanDomain = cleanDomain.split(":")[0];

  cleanDomain = cleanDomain.replace(/\.(com|in|net|org|info|co|io)$/, "");

  return cleanDomain.trim();
};

const getDomainWithProtocol = (domain) => {
  return `https://${domain}`;
};

// Helper to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    httpOnly: true,
    secure: false, // Set to true if using HTTPS
    sameSite: 'lax', // Must be 'none' for cross-origin
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
};


exports.profile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password").select("-access_token");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      ...user.toObject(),
      needsSetup: user.needsSetup()
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// New endpoint: Complete initial setup
exports.completeSetup = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan, domain } = req.body;

    // Validate inputs
    if (!plan || !domain) {
      return res.status(400).json({ 
        success: false,
        message: "Plan and domain are required" 
      });
    }

    // Validate plan
    const validPlans = ['free', 'basic', 'pro', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid plan selected" 
      });
    }

    // Clean and validate domain
    let cleanDomain = domain.toLowerCase().trim();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    cleanDomain = cleanDomain.replace(/\/$/, '');

    // Basic domain validation
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
    if (!domainRegex.test(cleanDomain)) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid domain format" 
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) { 
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }

    // Update user document
    user.selectedPlan = plan;
    user.primaryDomain = cleanDomain;
    user.hasCompletedSetup = true;
    await user.save();

    // Check if UserPlan already exists
    let userPlan = await UserPlan.findOne({ userId });
    
    if (userPlan) {
      // Update existing plan
      userPlan.rankTracker.plan = plan;
      userPlan.rankTracker.limits = getPlanLimits(plan);
      
      // Add domain if not already present
      const domainExists = userPlan.domains.some(d => d.domain === cleanDomain);
      if (!domainExists) {
        // Deactivate all domains
        userPlan.domains.forEach(d => d.isActive = false);
        // Add new domain as active
        userPlan.domains.push({
          domain: cleanDomain,
          isActive: true,
          addedAt: new Date()
        });
      } else {
        // Set existing domain as active
        userPlan.domains.forEach(d => {
          d.isActive = d.domain === cleanDomain;
        });
      }
      
      userPlan.activeDomain = cleanDomain;
      await userPlan.save();
    } else {
      // Create new UserPlan
      userPlan = new UserPlan({
        userId,
        domains: [{
          domain: cleanDomain,
          isActive: true,
          addedAt: new Date()
        }],
        activeDomain: cleanDomain,
        rankTracker: {
          plan: plan,
          limits: getPlanLimits(plan),
          usage: {
            domainsUsed: 1,
            keywordsUsed: 0,
            competitorsUsed: 0,
            updatesThisMonth: 0
          }
        },
        webCrawler: {
          plan: plan,
          limits: {
            pagesPerMonth: getWebCrawlerLimits(plan).pagesPerMonth,
            concurrentCrawls: getWebCrawlerLimits(plan).concurrentCrawls,
            dataRetentionDays: getWebCrawlerLimits(plan).dataRetentionDays
          },
          usage: {
            pagesThisMonth: 0,
            activeCrawls: 0
          }
        },
        subscription: {
          status: plan === 'free' ? 'active' : 'trial',
          startDate: new Date()
        },
        features: {
          betaFeatures: false,
          apiAccess: ['pro', 'enterprise'].includes(plan),
          whiteLabel: plan === 'enterprise',
          prioritySupport: ['pro', 'enterprise'].includes(plan)
        }
      });

      await userPlan.save();
    }

     const newKeyword = new Keyword({
      userId: user._id,
      keyword: extractKeywordsFromDomain(cleanDomain),
      targetDomain: cleanDomain,
      location: "United States",
      device: "desktop",
      language: "en",
      searchEngine: "google",
      updateFrequency: "monthly",
      tags: [],
      nextScheduledCheck: new Date(),
    });

    await newKeyword.save();
   
    try {
      await rankTrackerService.createSerpTask({
        keywordId: newKeyword._id,
        keyword: newKeyword.keyword,
        location: newKeyword.location,
        device: newKeyword.device,
        targetDomain: cleanDomain, // Send as "seokart.com"
        userId: user._id,
      });
    } catch (serpError) {
      console.error("Error creating SERP task:", serpError);
    }

        await RankTrackerActivity.create({
      userId: user._id,
      action: "keyword_added",
      details: {
        keyword: newKeyword.keyword,
        domain: cleanDomain,
      },
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
        source: "web",
      },
    });

    // Initialize backlink processing - don't let it affect registration
    try {
      console.log(`[REGISTER] Initializing backlink processing for: ${cleanDomain}`);
      
      // Create initial backlink document
      const backlinkInit = await backlinkService.createInitialDocument(user._id, cleanDomain);
      
      if (backlinkInit.success) {
        console.log(`[REGISTER] ✅ Backlink document created for: ${cleanDomain}`);
        
        // Start background processing (don't await - let it run async)
        processBacklinksInBackground(user._id, cleanDomain);
      } else {
        console.warn(`[REGISTER] ⚠️ Failed to create backlink document for: ${cleanDomain}`, backlinkInit.error);
      }
    } catch (backlinkError) {
      console.warn(`[REGISTER] ⚠️ Backlink initialization failed for: ${cleanDomain}`, backlinkError.message);
      // Don't throw error - continue with registration
    }

    // try {
    //   await webCrawler({
    //     websiteUrl: getDomainWithProtocol(cleanDomain),
    //     userId: user._id,
    //     concurrency: 15,
    //   });
    // } catch (crawlErr) {
    //   console.warn(
    //     "⚠️ Sitemap crawl failed during registration:",
    //     crawlErr.message
    //   );
    // }
    scrapeQueue.add("scrapeQueue", {
      websiteUrl: getDomainWithProtocol(cleanDomain),
      userId: user._id,
      concurrency: 15,
    });
    

    res.status(200).json({
      success: true,
      message: "Setup completed successfully",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture,
        hasCompletedSetup: user.hasCompletedSetup,
        selectedPlan: user.selectedPlan,
        primaryDomain: user.primaryDomain,
        needsSetup: false
      }
    });

  } catch (error) {
    console.error("Complete setup error:", error);
    res.status(500).json({ 
      success: false,
      message: error.message || "Failed to complete setup" 
    });
  }
};

async function processBacklinksInBackground(userId, websiteUrl) {
  try {
    console.log(`[REGISTER-BACKLINKS] Starting background backlink processing for: ${websiteUrl}`);
    
    const result = await backlinkService.fetchAndUpdateBacklinkData(userId, websiteUrl);
    
    if (result.success) {
      console.log(`[REGISTER-BACKLINKS] ✅ Background processing completed for: ${websiteUrl} - ${result.totalBacklinks} total backlinks`);
    } else {
      console.error(`[REGISTER-BACKLINKS] ❌ Background processing failed for: ${websiteUrl}`, result.error);
    }
  } catch (error) {
    console.error(`[REGISTER-BACKLINKS] ❌ Background processing error for: ${websiteUrl}`, error.message);
  }
}

// Helper function to get plan limits for rank tracker
function getPlanLimits(plan) {
  const limits = {
    free: {
      domains: 1,
      keywords: 10,
      competitors: 3,
      updateFrequency: 'weekly',
      aiTracking: false,
      historicalWeeks: 4
    },
    basic: {
      domains: 3,
      keywords: 100,
      competitors: 5,
      updateFrequency: 'daily',
      aiTracking: true,
      historicalWeeks: 12
    },
    pro: {
      domains: 10,
      keywords: 500,
      competitors: 10,
      updateFrequency: 'daily',
      aiTracking: true,
      historicalWeeks: 26
    },
    enterprise: {
      domains: -1, // unlimited
      keywords: -1,
      competitors: -1,
      updateFrequency: 'daily',
      aiTracking: true,
      historicalWeeks: 52
    }
  };
  
  return limits[plan] || limits.free;
}

// Helper function to get web crawler limits
function getWebCrawlerLimits(plan) {
  const limits = {
    free: {
      pagesPerMonth: 100,
      concurrentCrawls: 1,
      dataRetentionDays: 7
    },
    basic: {
      pagesPerMonth: 5000,
      concurrentCrawls: 3,
      dataRetentionDays: 30
    },
    pro: {
      pagesPerMonth: 25000,
      concurrentCrawls: 10,
      dataRetentionDays: 90
    },
    enterprise: {
      pagesPerMonth: 100000,
      concurrentCrawls: 50,
      dataRetentionDays: 365
    }
  };
  
  return limits[plan] || limits.free;
}