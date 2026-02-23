const mongoose = require('mongoose');

// User activity tracking schema
const UserActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  websiteUrl: { type: String, required: true },
  
  // Status and timing
  status: { 
    type: String, 
    enum: ['processing', 'analyzing', 'completed', 'failed', 'completed_with_errors'], 
    default: 'processing'
  },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  lastUpdated: { type: Date, default: Date.now },
  
  // Progress tracking
  progress: { type: Number, default: 0, min: 0, max: 100 },
  estimatedTimeRemaining: { type: Number, default: 0 }, // in seconds
  estimatedTotalUrls: { type: Number, default: 0 },
  
  // Phase tracking
  isSitemapCrawling: { type: Number, default: 1 }, // 1 = active, 0 = completed
  isWebpageCrawling: { type: Number, default: 0 }, // 0 = not started, 1 = fast scraping, 2 = slow analysis
  isBacklinkFetching: { type: Number, default: 0 },
  
  // Counts and statistics
  sitemapCount: { type: Number, default: 0 },
  webpageCount: { type: Number, default: 0 },
  webpagesSuccessful: { type: Number, default: 0 },
  webpagesFailed: { type: Number, default: 0 },
  
  // Processing flags
  fastScrapingCompleted: { type: Boolean, default: false },
  slowAnalysisCompleted: { type: Boolean, default: false },
  
  // Results tracking
  fastScrapingResults: {
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    avgTime: { type: Number, default: 0 },
    totalTime: { type: Number, default: 0 }
  },
  
  slowAnalysisResults: {
    duplicatesFound: { type: Number, default: 0 },
    brokenLinksFound: { type: Number, default: 0 },
    analyzed: { type: Number, default: 0 },
    updated: { type: Number, default: 0 }
  },
  
  // Error tracking
  errorMessages: [{ type: String }],
  slowAnalysisError: { type: String },
  
  // Crawl tracking
  crawlCount: { type: Number, default: 1 },
  
  // Backlink tracking (if applicable)
  backlinkSummaryId: { type: mongoose.Schema.Types.ObjectId },
  backlinkSummaryStatus: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending' 
  },
  backlinkError: { type: String },

   lastHeartbeat: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  heartbeatInterval: {
    type: Number,
    default: 5000 // 5 seconds
  },
  
  isStalled: {
    type: Boolean,
    default: false,
    index: true
  },
  
  crashRecovered: {
    type: Boolean,
    default: false
  },
  
  serverInstance: {
    type: String,
    default: null // Store server instance ID
  },
  
  jobId: {
    type: String,
    index: true,
    sparse: true
  },
  
  canRecover: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'user_activities'
});

// Instance methods
UserActivitySchema.methods.completeCrawl = function(success = true, errorMessage = null) {
  this.status = success ? 'completed' : 'failed';
  this.endTime = new Date();
  this.progress = success ? 100 : this.progress;
  this.isSitemapCrawling = 0;
  this.isWebpageCrawling = 0;
  this.estimatedTimeRemaining = 0;
  this.lastUpdated = new Date();
  
  if (errorMessage) {
    this.errorMessages = this.errorMessages || [];
    this.errorMessages.push(errorMessage);
  }
  
  return this.save();
};

UserActivitySchema.methods.getDuration = function() {
  if (!this.endTime || !this.startTime) {
    return null;
  }
  return this.endTime.getTime() - this.startTime.getTime();
};

UserActivitySchema.methods.getSuccessRate = function() {
  const total = this.webpagesSuccessful + this.webpagesFailed;
  if (total === 0) return 0;
  return ((this.webpagesSuccessful / total) * 100).toFixed(1);
};

UserActivitySchema.methods.isActive = function() {
  return ['processing', 'analyzing'].includes(this.status);
};

// Static methods
UserActivitySchema.statics.findActiveForUser = function(userId) {
  return this.find({
    userId,
    status: { $in: ['processing', 'analyzing'] }
  });
};

UserActivitySchema.statics.findByWebsite = function(userId, websiteUrl) {
  return this.find({ userId, websiteUrl }).sort({ startTime: -1 });
};

UserActivitySchema.statics.getRecentActivities = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ startTime: -1 })
    .limit(limit)
    .select('websiteUrl status startTime endTime progress webpagesSuccessful webpagesFailed');
};

UserActivitySchema.statics.findOrCreateActivity = async function(userId, websiteUrl) {
  let activity = await this.findOne({ userId, websiteUrl });
  let isNewCrawl = false;
  let canCrawl = true;

  if (!activity) {
    // Create new activity
    activity = new this({
      userId,
      websiteUrl,
      status: 'processing',
      startTime: new Date(),
      lastCrawlStarted: new Date(),
      progress: 0,
      crawlCount: 1
    });
    isNewCrawl = true;
  } else {
    // Check if crawl is already in progress
    const activeStatuses = ['processing', 'analyzing'];
    canCrawl = !activeStatuses.includes(activity.status);
  }

  return { activity, isNewCrawl, canCrawl };
};

// Indexes for performance
UserActivitySchema.index({ userId: 1, websiteUrl: 1 });
UserActivitySchema.index({ userId: 1, status: 1 });
UserActivitySchema.index({ startTime: -1 });
UserActivitySchema.index({ status: 1, lastUpdated: 1 });

// Compound index for finding active activities
UserActivitySchema.index({ 
  userId: 1, 
  websiteUrl: 1, 
  status: 1 
});

// TTL index for automatic cleanup of old completed activities (optional)
UserActivitySchema.index(
  { endTime: 1 }, 
  { 
    expireAfterSeconds: 7776000, // 90 days
    partialFilterExpression: { 
      status: { $in: ['completed', 'failed', 'completed_with_errors'] } 
    }
  }
);

// Virtual for processing time
UserActivitySchema.virtual('processingTime').get(function() {
  if (this.endTime && this.startTime) {
    return this.endTime.getTime() - this.startTime.getTime();
  }
  return null;
});

// Virtual for current phase description
UserActivitySchema.virtual('currentPhase').get(function() {
  if (this.isSitemapCrawling === 1) {
    return 'sitemap_processing';
  } else if (this.isWebpageCrawling === 1) {
    return 'fast_scraping';
  } else if (this.isWebpageCrawling === 2) {
    return 'slow_analysis';
  } else if (this.isBacklinkFetching === 1) {
    return 'backlink_fetching';
  } else {
    return this.status;
  }
});

// Pre-save middleware
UserActivitySchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  
  // Ensure progress is within bounds
  if (this.progress < 0) this.progress = 0;
  if (this.progress > 100) this.progress = 100;
  
  // Auto-set status based on progress and completion flags
  if (this.progress === 100 && this.status === 'processing') {
    this.status = 'completed';
  }
  
  next();
});

// Session tracking schema (for real-time monitoring)
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userActivityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserActivity', required: true },
  
  // Session details
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  lastActivity: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
  
  // Session statistics
  stats: {
    pagesProcessed: { type: Number, default: 0 },
    pagesSuccessful: { type: Number, default: 0 },
    pagesFailed: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 },
    totalResponseTime: { type: Number, default: 0 }
  },
  
  // Client information
  clientInfo: {
    userAgent: { type: String },
    ipAddress: { type: String },
    browser: { type: String },
    os: { type: String }
  }
}, {
  timestamps: true,
  collection: 'user_sessions'
});

// TTL index for automatic session cleanup
SessionSchema.index(
  { lastActivity: 1 }, 
  { expireAfterSeconds: 86400 } // 24 hours
);

SessionSchema.index({ userId: 1, status: 1 });
SessionSchema.index({ userActivityId: 1 });

// System metrics schema (for monitoring)
const SystemMetricsSchema = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  
  // System performance
  performance: {
    cpuUsage: { type: Number },
    memoryUsage: { type: Number },
    heapUsed: { type: Number },
    heapTotal: { type: Number },
    loadAverage: [{ type: Number }]
  },
  
  // Scraper metrics
  scraper: {
    activeJobs: { type: Number, default: 0 },
    queueLength: { type: Number, default: 0 },
    totalRequests: { type: Number, default: 0 },
    successfulRequests: { type: Number, default: 0 },
    failedRequests: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 }
  },
  
  // User metrics
  users: {
    activeUsers: { type: Number, default: 0 },
    totalSessions: { type: Number, default: 0 },
    activeSessions: { type: Number, default: 0 }
  },
  
  // Database metrics (optional)
  database: {
    connections: { type: Number },
    operationsPerSecond: { type: Number },
    avgOperationTime: { type: Number }
  }
}, {
  timestamps: false,
  collection: 'system_metrics'
});

// TTL index for automatic metrics cleanup
SystemMetricsSchema.index(
  { timestamp: 1 }, 
  { expireAfterSeconds: 2592000 } // 30 days
);

// Export models
module.exports = {
  UserActivity: mongoose.model('UserActivity', UserActivitySchema),
  Session: mongoose.model('Session', SessionSchema),
  SystemMetrics: mongoose.model('SystemMetrics', SystemMetricsSchema)
};