const mongoose = require('mongoose');

// Domain Schema
const domainSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: false
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  // Optional: store domain-specific settings
  settings: {
    trackingEnabled: { type: Boolean, default: true },
    notifications: { type: Boolean, default: true }
  }
});

// User Plan Schema (for all services - rank tracker, web crawler, etc.)
const userPlanSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  
  // Domains array
  domains: {
    type: [domainSchema],
    default: [],
    validate: {
      validator: function(domains) {
        // Ensure only one domain is active at a time
        const activeDomains = domains.filter(d => d.isActive);
        return activeDomains.length <= 1;
      },
      message: 'Only one domain can be active at a time'
    }
  },
  
  // Currently active domain (for quick reference)
  activeDomain: {
    type: String,
    trim: true,
    lowercase: true
  },
  
  // Service-specific plans
  rankTracker: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      default: 'free'
    },
    limits: {
      domains: { type: Number, default: 1 }, // free: 1 domain
      keywords: { type: Number, default: 3 }, // free: 3 keywords
      competitors: { type: Number, default: 3 }, // free: 3 competitors
      updateFrequency: { 
        type: String, 
        enum: ['monthly','weekly','daily'], 
        default: 'monthly' // free: monthly updates
      },
      aiTracking: { type: Boolean, default: true }, 
      historicalMonths: { type: Number, default: 8 } 
    },
    usage: {
      domainsUsed: { type: Number, default: 0 },
      keywordsUsed: { type: Number, default: 0 },
      competitorsUsed: { type: Number, default: 0 },
      lastUpdate: Date,
      updatesThisMonth: { type: Number, default: 0 }
    }
  },
  
  webCrawler: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'pro', 'enterprise'],
      default: 'free'
    },
    limits: {
      pagesPerMonth: { type: Number, default: 100 },
      concurrentCrawls: { type: Number, default: 1 },
      dataRetentionDays: { type: Number, default: 30 }
    },
    usage: {
      pagesThisMonth: { type: Number, default: 0 },
      activeCrawls: { type: Number, default: 0 }
    }
  },
  
  // Billing info
  subscription: {
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'cancelled', 'trial'], 
      default: 'trial' 
    },
    startDate: { type: Date, default: Date.now },
    endDate: Date,
    paymentMethod: String,
    lastPayment: Date,
    nextBillingDate: Date,
    amount: Number,
    currency: { type: String, default: 'USD' }
  },
  
  // Feature flags
  features: {
    betaFeatures: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false },
    whiteLabel: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// INDEXES
userPlanSchema.index({ userId: 1 }, { unique: true });
userPlanSchema.index({ 'rankTracker.plan': 1 });
userPlanSchema.index({ 'webCrawler.plan': 1 });
userPlanSchema.index({ 'subscription.status': 1 });
userPlanSchema.index({ 'subscription.nextBillingDate': 1 });
userPlanSchema.index({ activeDomain: 1 });
userPlanSchema.index({ 'domains.domain': 1 });

// PRE-SAVE MIDDLEWARE
userPlanSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Update activeDomain field based on active domain in array
  const activeDomainDoc = this.domains.find(d => d.isActive);
  this.activeDomain = activeDomainDoc ? activeDomainDoc.domain : null;
  
  // Update domainsUsed count
  this.rankTracker.usage.domainsUsed = this.domains.length;
  
  next();
});

// METHODS

// Domain management methods
userPlanSchema.methods.addDomain = function(domainName, setAsActive = false) {
  // Check if domain already exists
  const existingDomain = this.domains.find(d => d.domain === domainName.toLowerCase());
  if (existingDomain) {
    throw new Error('Domain already exists');
  }
  
  // Check domain limit
  if (this.hasReachedRankTrackerLimit('domains')) {
    throw new Error('Domain limit reached for current plan');
  }
  
  // If setting as active, deactivate other domains
  if (setAsActive) {
    this.domains.forEach(d => d.isActive = false);
  }
  
  // Add new domain
  this.domains.push({
    domain: domainName.toLowerCase(),
    isActive: setAsActive,
    addedAt: new Date()
  });
  
  return this.save();
};

userPlanSchema.methods.setActiveDomain = function(domainName) {
  const domain = this.domains.find(d => d.domain === domainName.toLowerCase());
  if (!domain) {
    throw new Error('Domain not found');
  }
  
  // Deactivate all domains
  this.domains.forEach(d => d.isActive = false);
  
  // Activate selected domain
  domain.isActive = true;
  
  return this.save();
};

userPlanSchema.methods.removeDomain = function(domainName) {
  const domainIndex = this.domains.findIndex(d => d.domain === domainName.toLowerCase());
  if (domainIndex === -1) {
    throw new Error('Domain not found');
  }
  
  const removedDomain = this.domains[domainIndex];
  this.domains.splice(domainIndex, 1);
  
  // If removed domain was active, set another domain as active (if any)
  if (removedDomain.isActive && this.domains.length > 0) {
    this.domains[0].isActive = true;
  }
  
  return this.save();
};

userPlanSchema.methods.getActiveDomain = function() {
  return this.domains.find(d => d.isActive);
};

userPlanSchema.methods.getAllDomains = function() {
  return this.domains.sort((a, b) => b.addedAt - a.addedAt);
};

// Check if user can access AI tracking
userPlanSchema.methods.canAccessAiTracking = function() {
  return this.rankTracker.limits.aiTracking;
};

// Check if user has reached limits for rank tracker
userPlanSchema.methods.hasReachedRankTrackerLimit = function(resource) {
  const usage = this.rankTracker.usage;
  const limits = this.rankTracker.limits;
  
  switch(resource) {
    case 'keywords':
      return usage.keywordsUsed >= limits.keywords;
    case 'competitors':
      return usage.competitorsUsed >= limits.competitors;
    case 'domains':
      return limits.domains !== -1 && this.domains.length >= limits.domains;
    default:
      return false;
  }
};

// Check if user can perform updates based on frequency
userPlanSchema.methods.canUpdateRankings = function() {
  const frequency = this.rankTracker.limits.updateFrequency;
  const lastUpdate = this.rankTracker.usage.lastUpdate;
  
  if (!lastUpdate) return true;
  
  const now = new Date();
  const diffHours = (now - lastUpdate) / (1000 * 60 * 60);
  
  switch(frequency) {
    case 'monthly':
      return diffHours >= 720; // 30 days
    default:
      return false;
  }
};

// Update usage counters
userPlanSchema.methods.incrementUsage = function(service, resource, amount = 1) {
  if (service === 'rankTracker') {
    switch(resource) {
      case 'keywords':
        this.rankTracker.usage.keywordsUsed += amount;
        break;
      case 'competitors':
        this.rankTracker.usage.competitorsUsed += amount;
        break;
      case 'domains':
        this.rankTracker.usage.domainsUsed += amount;
        break;
      case 'updates':
        this.rankTracker.usage.updatesThisMonth += amount;
        this.rankTracker.usage.lastUpdate = new Date();
        break;
    }
  } else if (service === 'webCrawler') {
    switch(resource) {
      case 'pages':
        this.webCrawler.usage.pagesThisMonth += amount;
        break;
      case 'crawls':
        this.webCrawler.usage.activeCrawls += amount;
        break;
    }
  }
  
  return this.save();
};

// Reset monthly usage (called by cron job)
userPlanSchema.methods.resetMonthlyUsage = function() {
  this.rankTracker.usage.updatesThisMonth = 0;
  this.webCrawler.usage.pagesThisMonth = 0;
  return this.save();
};

// Upgrade/downgrade plan
userPlanSchema.methods.changePlan = function(service, newPlan) {
  const planLimits = {
    rankTracker: {
      free: {
        domains: 1,
        keywords: 3,
        competitors: 3,
        updateFrequency: 'monthly',
        aiTracking: false,
        historicalMonths: 3
      },
      basic: {
        domains: 3,
        keywords: 50,
        competitors: 10,
        updateFrequency: 'monthly',
        aiTracking: true,
        historicalMonths: 6
      },
      premium: {
        domains: 10,
        keywords: 200,
        competitors: 25,
        updateFrequency: 'monthly',
        aiTracking: true,
        historicalMonths: 12
      },
      enterprise: {
        domains: -1, // unlimited
        keywords: -1,
        competitors: -1,
        updateFrequency: 'monthly',
        aiTracking: true,
        historicalMonths: 24
      }
    },
    webCrawler: {
      free: {
        pagesPerMonth: 100,
        concurrentCrawls: 1,
        dataRetentionDays: 30
      },
      basic: {
        pagesPerMonth: 5000,
        concurrentCrawls: 3,
        dataRetentionDays: 90
      },
      premium: {
        pagesPerMonth: 50000,
        concurrentCrawls: 10,
        dataRetentionDays: 365
      }
    }
  };
  
  if (planLimits[service] && planLimits[service][newPlan]) {
    this[service].plan = newPlan;
    this[service].limits = { ...this[service].limits, ...planLimits[service][newPlan] };
  }
  
  return this.save();
};

// Model
const UserPlan = mongoose.model('UserPlan', userPlanSchema);

module.exports = { UserPlan };