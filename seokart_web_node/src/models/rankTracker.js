const mongoose = require("mongoose");

// Enhanced Keyword Schema
const keywordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  keyword: { type: String, required: true, trim: true },
  targetDomain: { type: String, required: true, trim: true, lowercase: true },

  // Search Parameters
  location: { type: String, default: "United States" },
  device: { type: String, default: "desktop" },
  language: { type: String, default: "en" },
  searchEngine: { type: String, default: "google" },

  // Tracking State
  isActive: { type: Boolean, default: true },
  lastTaskId: String,
  isDataFetched: { type: Boolean, default: false },

  // Current Rankings (denormalized for performance)
  currentRanking: {
    position: Number,
    url: String,
    title: String,
    lastUpdated: Date,
    previousPosition: Number,
    trend: { type: String, enum: ["up", "down", "same", "new", "lost"] },
  },

  // Scheduling based on user plan
  nextScheduledCheck: {
    type: Date,
    default: function () {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return nextMonth;
    },
  },
  lastChecked: Date,
  updateFrequency: {
    type: String,
    default: "monthly",
  },

  // Metadata
  searchVolume: Number,
  difficulty: Number,
  tags: [String],
  notes: String,

  createdAt: { type: Date, default: Date.now },
});

// Enhanced Competitor Schema
const competitorSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  domain: { type: String, required: true, trim: true, lowercase: true },
  name: String,
  isActive: { type: Boolean, default: true },

  // Aggregated metrics (updated periodically)
  stats: {
    averagePosition: Number,
    keywordCount: Number,
    visibilityScore: Number, // calculated metric
    positionDistribution: {
      top3: { type: Number, default: 0 },
      top10: { type: Number, default: 0 },
      top20: { type: Number, default: 0 },
      top50: { type: Number, default: 0 },
      top100: { type: Number, default: 0 },
    },
    aiMentions: {
      googleAiOverview: { type: Number, default: 0 },
      googleAiMode: { type: Number, default: 0 },
      chatgpt: { type: Number, default: 0 },
      totalKeywords: { type: Number, default: 0 },
      aiVisibilityScore: Number, // percentage of keywords with AI mentions
    },
    lastAnalyzed: Date,
  },

  // Competitor metadata
  industry: String,
  country: String,
  companySize: String,
  tags: [String],
  notes: String,

  createdAt: { type: Date, default: Date.now },
});

// Task Schema for SERP API management
const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  taskId: { type: String, required: true, unique: true },
  keywordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Keyword",
    required: true,
  },

  pingbackInfo: {
    url: String,
    tag: String,
    registered: { type: Boolean, default: false },
    received: { type: Boolean, default: false },
    receivedAt: Date,
    status: Number,
  },

  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },

  requestData: {
    keyword: String,
    location: String,
    device: String,
    targetDomain: String,
    includeAiTracking: { type: Boolean, default: false },
    competitors: [String], // domains to track
  },

  // Results data (stored temporarily until processed)
  responseData: {
    totalResults: Number,
    organicResults: [
      {
        position: Number,
        domain: String,
        url: String,
        title: String,
        snippet: String,
      },
    ],
    aiOverview: {
      isPresent: Boolean,
      content: String,
      mentionedDomains: [String],
    },
    serpFeatures: mongoose.Schema.Types.Mixed,
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  completedAt: Date,

  // Error handling
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },

  // Auto-cleanup after 24 hours
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
});

const aiModeTaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  taskId: { type: String, required: true, unique: true },
  keywordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Keyword",
    required: true,
  },

  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },

  requestData: {
    keyword: String,
    location: String,
    language: String,
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  completedAt: Date,

  // Error handling
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },

  pingbackInfo: {
    url: String,
    tag: String,
    registered: { type: Boolean, default: false },
    received: { type: Boolean, default: false },
    receivedAt: Date,
    status: Number,
  },

  callbackReceived: { type: Boolean, default: false },
  callbackReceivedAt: Date,
  dataFetchedBy: {
    type: String,
    enum: ["callback", "cron", null],
    default: null,
  },
  dataFetchedAt: Date,

  // Auto-cleanup after 24 hours
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
});

const monthlyRankingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  keywordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Keyword",
    required: true,
  },
  domain: { type: String, required: true, trim: true, lowercase: true },
  keyword: { type: String, required: true, trim: true }, // denormalized for faster queries

  rankings: [
    {
      month: {
        type: String,
        required: true,
        match: /^\d{4}-\d{2}$/,
      },
      position: { type: Number, min: 1, max: 100 },
      previousPosition: { type: Number, min: 1, max: 100 },
      url: String,
      title: String,

      trend: {
        type: String,
        enum: ["up", "down", "same", "new", "lost"],
        default: "new",
      },

      checkedAt: { type: Date, default: Date.now },
    },
  ],

  currentMonth: String,
  currentPosition: Number,
  lastUpdated: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now },
});

// SERP Snapshot Schema for detailed analysis (optional for premium users)
const serpSnapshotSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  keywordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Keyword",
    required: true,
  },
  keyword: { type: String, required: true },
  month: { type: String, required: true },

  // SERP metadata
  searchParameters: {
    location: String,
    device: String,
    language: String,
    searchEngine: String,
  },
  totalResults: Number,

  // AI Overview comprehensive data
  aiOverview: {
    googleAiOverview: {
      isPresent: { type: Boolean, default: false },
      content: String, // truncated for analysis
      mentionedDomains: [String],
      sourcesCount: Number,
      sources: [
        {
          domain: String,
          url: String,
          title: String,
          position: Number,
        },
      ],
    },
    googleAiMode: {
      isPresent: { type: Boolean, default: false },
      mentionedDomains: [String],
      content: String,
    },
    chatgptData: {
      mentionedDomains: [String],
      lastChecked: Date,
      queryResponse: String, // truncated ChatGPT response
    },
  },

  // Complete organic results (top 100)
  organicResults: [
    {
      position: { type: Number, min: 1, max: 100 },
      domain: String,
      url: String,
      title: String,
      snippet: String,
      isTargetDomain: Boolean,
      isCompetitor: Boolean,
    },
  ],

  // SERP Features analysis
  serpFeatures: {
    featuredSnippet: {
      isPresent: Boolean,
      ownedBy: String,
      content: String,
    },
    localPack: {
      isPresent: Boolean,
      businesses: [String],
    },
    peopleAlsoAsk: {
      isPresent: Boolean,
      questions: [String],
    },
    relatedSearches: {
      isPresent: Boolean,
      searches: [String],
    },
    shoppingResults: Boolean,
    videoResults: Boolean,
    imageResults: Boolean,
    newsResults: Boolean,
    twitterResults: Boolean,
  },

  // Performance metrics
  loadTime: Number, // SERP load time in ms
  dataQuality: {
    completeness: Number, // percentage of expected data received
    accuracy: Number, // confidence score
    freshness: Date, // when this data was captured
  },

  // Auto-cleanup after retention period
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
  },

  createdAt: { type: Date, default: Date.now },
});

// Activity Log Schema for audit trail
const rankTrackerActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: {
    type: String,
    required: true,
    enum: [
      "keyword_added",
      "keyword_removed",
      "keyword_updated",
      "competitor_added",
      "competitor_removed",
      "competitor_updated",
      "rankings_updated",
      "rankings_manual_refresh",
      "plan_upgraded",
      "plan_downgraded",
      "ai_tracking_enabled",
      "ai_tracking_disabled",
      "export_data",
      "import_keywords",
      "settings_updated",
      "notification_sent",
      "ai_mode_updated",
    ],
  },
  details: {
    keyword: String,
    domain: String,
    previousPlan: String,
    newPlan: String,
    affectedCount: Number,
    changeSummary: String,
    errorMessage: String,
  },
  timestamp: { type: Date, default: Date.now },

  // Request metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    sessionId: String,
    source: {
      // web, api, cron, etc.
      type: String,
      enum: ["web", "api", "cron", "system", "callback"],
      default: "web",
    },
  },
});

// Keyword Suggestions Cache Schema
const keywordSuggestionSchema = new mongoose.Schema({
  domain: { type: String, required: true, trim: true, lowercase: true }, // trimmed domain like 'seokart'
  keyword: { type: String, required: true, trim: true },
  source: { type: String, default: "dataforseo_keywords" },
  isAdded: { type: Boolean, default: false }, // flag to show if keyword is added by user
  createdAt: { type: Date, default: Date.now },
  // Auto-expire after 30 days to refresh suggestions
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
});

// Competitor Suggestions Cache Schema
const competitorSuggestionSchema = new mongoose.Schema({
  domain: { type: String, required: true, trim: true, lowercase: true },
  competitorDomain: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  name: { type: String, required: true },
  source: { type: String, default: "dataforseo_serp" },
  isAdded: { type: Boolean, default: false }, // flag to show if competitor is added by user
  createdAt: { type: Date, default: Date.now },
  // Auto-expire after 30 days to refresh suggestions
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
});

const monthlyAiDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  keywordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Keyword",
    required: true,
  },
  keyword: { type: String, required: true, trim: true }, // denormalized for faster queries
  month: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}$/, // format: "2025-07"
  },
  carrier: {
    type: String,
    required: true,
    enum: ["chatgpt", "ai_overview", "ai_mode"],
  },

  // AI Results data
  results: [
    {
      domain: { type: String, required: true, trim: true, lowercase: true },
      url: String,
      title: String,
      snippet: String,
      position: Number, // for ai_overview and ai_mode
      relevanceScore: Number, // calculated relevance to keyword
      mentionContext: String, // how the domain is mentioned
    },
  ],

  // Metadata
  totalResults: { type: Number, default: 0 },
  processingTime: Number, // API response time in ms
  dataQuality: {
    completeness: { type: Number, default: 100 }, // percentage
    freshness: { type: Date, default: Date.now },
  },

  // Raw response data (truncated for analysis)
  rawResponse: {
    content: String, // first 2000 chars of response
    sources: [String], // source URLs for ai_overview
    confidence: Number, // AI confidence score if available
  },

  createdAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },

  // Auto-cleanup after 60 days
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  },
});

// INDEXES FOR PERFORMANCE

// Keyword indexes
keywordSchema.index({ userId: 1, isActive: 1 });
keywordSchema.index(
  {
    userId: 1,
    keyword: 1,
    targetDomain: 1,
    location: 1,
    device: 1,
    language: 1,
    searchEngine: 1,
  },
  { unique: true }
);
keywordSchema.index({ nextScheduledCheck: 1, isActive: 1 });
keywordSchema.index({ userId: 1, targetDomain: 1 });
keywordSchema.index({ updateFrequency: 1, lastChecked: 1 });
keywordSchema.index({ "currentRanking.lastUpdated": -1 });

// Competitor indexes
competitorSchema.index({ userId: 1, domain: 1 }, { unique: true });
competitorSchema.index({ userId: 1, isActive: 1 });
competitorSchema.index({ userId: 1, "stats.averagePosition": 1 });

// Task indexes
taskSchema.index({ userId: 1, status: 1 });
taskSchema.index({ taskId: 1 }, { unique: true });
taskSchema.index({ keywordId: 1, status: 1 });
taskSchema.index({ status: 1, createdAt: 1 });
taskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// AI mode Task indexes
aiModeTaskSchema.index({ userId: 1, status: 1 });
aiModeTaskSchema.index({ taskId: 1 }, { unique: true });
aiModeTaskSchema.index({ keywordId: 1, status: 1 });
aiModeTaskSchema.index({ status: 1, createdAt: 1 });
aiModeTaskSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

monthlyRankingSchema.index(
  { userId: 1, domain: 1, keyword: 1 },
  { unique: true }
);
monthlyRankingSchema.index({ userId: 1, keywordId: 1 });
monthlyRankingSchema.index({ domain: 1, keyword: 1 });
monthlyRankingSchema.index({ userId: 1, currentMonth: 1 });
monthlyRankingSchema.index({ "rankings.month": 1 });
monthlyRankingSchema.index({ userId: 1, domain: 1, currentPosition: 1 });

// SERP Snapshot indexes
serpSnapshotSchema.index({ userId: 1, keywordId: 1, month: 1 });
serpSnapshotSchema.index({ userId: 1, month: 1 });
serpSnapshotSchema.index({ "aiOverview.googleAiOverview.mentionedDomains": 1 });
serpSnapshotSchema.index({ "aiOverview.chatgptData.mentionedDomains": 1 });
serpSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Activity indexes
rankTrackerActivitySchema.index({ userId: 1, timestamp: -1 });
rankTrackerActivitySchema.index({ action: 1, timestamp: -1 });
rankTrackerActivitySchema.index({ userId: 1, action: 1, timestamp: -1 });

keywordSuggestionSchema.index({ domain: 1, keyword: 1 }, { unique: true });
keywordSuggestionSchema.index({ domain: 1, isAdded: 1 });
keywordSuggestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

competitorSuggestionSchema.index(
  { domain: 1, competitorDomain: 1 },
  { unique: true }
);
competitorSuggestionSchema.index({ domain: 1, isAdded: 1 });
competitorSuggestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

monthlyAiDataSchema.index(
  { userId: 1, keywordId: 1, month: 1, carrier: 1 },
  { unique: true }
);
monthlyAiDataSchema.index({ userId: 1, month: 1, carrier: 1 });
monthlyAiDataSchema.index({ keyword: 1, carrier: 1 });
monthlyAiDataSchema.index({ "results.domain": 1 });
monthlyAiDataSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// METHODS AND MIDDLEWARE

monthlyRankingSchema.methods.addMonthlyRanking = function (monthData) {
  const {
    month,
    position,
    url,
    title,
    previousPosition = null,
    serpFeatures = [],
    aiTracking = {},
  } = monthData;

  let trend = "new";
  if (previousPosition !== null) {
    if (position < previousPosition) trend = "up";
    else if (position > previousPosition) trend = "down";
    else trend = "same";
  } else if (this.rankings.length > 0) {
    const lastRanking = this.rankings[this.rankings.length - 1];
    const lastPos = lastRanking.position;
    if (position < lastPos) trend = "up";
    else if (position > lastPos) trend = "down";
    else trend = "same";
  }

  this.rankings = this.rankings.filter((r) => r.month !== month);

  // Add new month data with additional fields
  this.rankings.push({
    month,
    position,
    previousPosition,
    url,
    title,
    trend,
    serpFeatures,
    aiTracking,
    checkedAt: new Date(),
  });

  this.rankings.sort((a, b) => b.month.localeCompare(a.month));
  if (this.rankings.length > 8) {
    this.rankings = this.rankings.slice(0, 8);
  }

  this.currentMonth = month;
  this.currentPosition = position;
  this.currentStatus = position ? "ranked" : "out_of_top_100";
  this.lastUpdated = new Date();

  return this.save();
};

// Static method to get current month string
monthlyRankingSchema.statics.getCurrentMonth = function () {
  const now = new Date();
  const month = now.getMonth() + 1; // getMonth() is zero-based
  return `${now.getFullYear()}-${month.toString().padStart(2, "0")}`;
};

// Method to get ranking history for charts
monthlyRankingSchema.methods.getRankingHistory = function (months = 12) {
  return this.rankings
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
    .map((r) => ({
      month: r.month,
      position: r.position,
      trend: r.trend,
    }));
};

// Method to calculate visibility score for competitor
competitorSchema.methods.calculateVisibilityScore = function () {
  const dist = this.stats.positionDistribution;
  const total = dist.top3 + dist.top10 + dist.top20 + dist.top50 + dist.top100;

  if (total === 0) return 0;

  // Weighted visibility score
  const score =
    (dist.top3 * 100 +
      dist.top10 * 80 +
      dist.top20 * 60 +
      dist.top50 * 40 +
      dist.top100 * 20) /
    total;

  return Math.round(score);
};

keywordSchema.methods.updateNextScheduledCheck = function () {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  this.nextScheduledCheck = nextMonth;
  return this.save();
};

// Models
const Keyword = mongoose.model("Keyword", keywordSchema);
const Competitor = mongoose.model("Competitor", competitorSchema);
const Task = mongoose.model("Task", taskSchema);
const AiModeTask = mongoose.model("AiModeTask", aiModeTaskSchema);
const MonthlyRanking = mongoose.model("MonthlyRanking", monthlyRankingSchema);
const SerpSnapshot = mongoose.model("SerpSnapshot", serpSnapshotSchema);
const RankTrackerActivity = mongoose.model(
  "RankTrackerActivity",
  rankTrackerActivitySchema
);
const KeywordSuggestion = mongoose.model(
  "KeywordSuggestion",
  keywordSuggestionSchema
);
const CompetitorSuggestion = mongoose.model(
  "CompetitorSuggestion",
  competitorSuggestionSchema
);
const MonthlyAiData = mongoose.model("MonthlyAiData", monthlyAiDataSchema);

module.exports = {
  Keyword,
  Competitor,
  Task,
  MonthlyRanking,
  SerpSnapshot,
  RankTrackerActivity,
  KeywordSuggestion,
  CompetitorSuggestion,
  MonthlyAiData,
  AiModeTask,
};
