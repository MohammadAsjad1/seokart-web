const mongoose = require("mongoose");

// Schema to track individual API calls - SIMPLIFIED
const dataForSeoUsageSchema = new mongoose.Schema(
  {
    // Identifiers
    taskId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    keywordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Keyword",
      index: true,
    },

    // API Details
    apiEndpoint: {
      type: String,
      required: true,
      enum: [
        "serp_google_organic_task_post",
        "serp_google_organic_task_get",
        "serp_google_ai_mode_task_post",
        "serp_google_ai_mode_task_get",
        "keywords_data_google_keyword_ideas_live",
        "keywords_data_google_keyword_volume_live",
        "other",
      ],
    },
    apiType: {
      type: String,
      required: true,
      enum: [
        "SERP",
        "Keywords Data",
        "Domain Analytics",
        "On-Page",
        "DataForSEO Labs",
      ],
    },

    // Cost Information - SIMPLIFIED
    creditsCost: {
      type: Number,
      required: true,
      min: 0,
    },
    dollarCost: {
      type: Number,
      required: true,
      min: 0,
    },

    // Request Details - SIMPLIFIED
    requestData: {
      keyword: String,
      location: String,
      language: String,
      device: String,
      targetDomain: String,
      depth: Number,
      limit: Number,
      includeAiTracking: Boolean,
      additionalParams: mongoose.Schema.Types.Mixed,
    },

    // Response Information - SIMPLIFIED
    responseStatus: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "pending",
    },
    responseData: {
      totalResults: Number,
      itemsCount: Number,
      processingTime: Number,
      serpFeatures: Number,
      cost: Number,
      statusCode: Number,
      additionalMetrics: mongoose.Schema.Types.Mixed,
    },

    // Error Information
    errorMessage: String,
    errorCode: String,

    // Timestamps
    requestedAt: {
      type: Date,
      default: Date.now,
      // index: true,
    },
    completedAt: Date,

    // Billing fields - auto-generated
    billingMonth: {
      type: String, // Format: "YYYY-MM"
      index: true,
    },
    billingDate: {
      type: String, // Format: "YYYY-MM-DD"
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Schema for monthly usage summaries - SIMPLIFIED
const dataForSeoMonthlySummarySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Time Period
    month: {
      type: String, // Format: "2024-01"
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },

    // Usage Statistics - SIMPLIFIED
    totalApiCalls: {
      type: Number,
      default: 0,
    },
    totalCreditsUsed: {
      type: Number,
      default: 0,
    },
    totalDollarsSpent: {
      type: Number,
      default: 0,
    },

    // Breakdown by API Type
    usageByApiType: [
      {
        apiType: String,
        apiCalls: { type: Number, default: 0 },
        creditsUsed: { type: Number, default: 0 },
        dollarsSpent: { type: Number, default: 0 },
      },
    ],

    // Breakdown by Endpoint
    usageByEndpoint: [
      {
        endpoint: String,
        apiCalls: { type: Number, default: 0 },
        creditsUsed: { type: Number, default: 0 },
        dollarsSpent: { type: Number, default: 0 },
      },
    ],

    // Daily breakdown
    dailyUsage: [
      {
        date: String, // Format: "2024-01-15"
        apiCalls: { type: Number, default: 0 },
        creditsUsed: { type: Number, default: 0 },
        dollarsSpent: { type: Number, default: 0 },
      },
    ],

    // Success/Failure rates
    successfulCalls: { type: Number, default: 0 },
    failedCalls: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 }, // Percentage

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Schema for API pricing configuration - SIMPLIFIED
const dataForSeoPricingSchema = new mongoose.Schema(
  {
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    apiType: {
      type: String,
      required: true,
      enum: [
        "SERP",
        "Keywords Data",
        "Backlinks",
        "Domain Analytics",
        "On-Page",
        "DataForSEO Labs",
      ],
    },

    // Pricing Information - SIMPLIFIED (main field)
    dollarsPerRequest: {
      type: Number,
      required: true,
    },

    // Optional fields for reference
    creditsPerRequest: {
      type: Number,
      default: 1,
    },
    dollarsPerCredit: {
      type: Number,
      default: 0.01,
    },

    // Metadata
    description: String,
    isActive: { type: Boolean, default: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
dataForSeoUsageSchema.index({ userId: 1, billingMonth: 1 });
dataForSeoUsageSchema.index({ taskId: 1, responseStatus: 1 });
dataForSeoUsageSchema.index({ requestedAt: 1 });
dataForSeoUsageSchema.index({ apiEndpoint: 1, billingDate: 1 });

dataForSeoMonthlySummarySchema.index({ userId: 1, month: 1 }, { unique: true });
dataForSeoMonthlySummarySchema.index({ year: 1, month: 1 });

dataForSeoPricingSchema.index({ endpoint: 1, isActive: 1 });

// Pre-save middleware to auto-generate billing periods
dataForSeoUsageSchema.pre("save", function (next) {
  if (this.isNew) {
    const date = this.requestedAt || new Date();
    this.billingMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    this.billingDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  next();
});

// Static method to get pricing for an endpoint
dataForSeoPricingSchema.statics.getPricing = async function (endpoint) {
  return await this.findOne({ endpoint, isActive: true });
};

// Instance method to calculate total cost (simple)
dataForSeoUsageSchema.methods.calculateCost = function () {
  return this.dollarCost;
};

// Static method to initialize default pricing (run once)
dataForSeoPricingSchema.statics.initializeDefaultPricing = async function () {
  const defaultPricing = [
    {
      endpoint: "serp_google_organic_task_post",
      apiType: "SERP",
      dollarsPerRequest: 0.0006,
      creditsPerRequest: 1,
      description: "Google Organic SERP Task Post"
    },
    {
      endpoint: "serp_google_organic_task_get",
      apiType: "SERP",
      dollarsPerRequest: 0.0006,
      creditsPerRequest: 1,
      description: "Google Organic SERP Task Get"
    },
    {
      endpoint: "serp_google_ai_mode_task_post",
      apiType: "SERP",
      dollarsPerRequest: 0.0006,
      creditsPerRequest: 1,
      description: "Google AI Mode Task Post"
    },
    {
      endpoint: "serp_google_ai_mode_task_get",
      apiType: "SERP",
      dollarsPerRequest: 0.0006,
      creditsPerRequest: 1,
      description: "Google AI Mode Task Get"
    },
    {
      endpoint: "keywords_data_google_keyword_ideas_live",
      apiType: "Keywords Data",
      dollarsPerRequest: 0.01,
      creditsPerRequest: 10,
      description: "Google Keyword Ideas Live"
    },
    {
      endpoint: "keywords_data_google_keyword_volume_live",
      apiType: "Keywords Data",
      dollarsPerRequest: 0.001,
      creditsPerRequest: 1,
      description: "Google Keyword Volume Live"
    }
  ];

  for (const pricing of defaultPricing) {
    await this.findOneAndUpdate(
      { endpoint: pricing.endpoint },
      pricing,
      { upsert: true, new: true }
    );
  }

  console.log("✅ Default pricing initialized");
};

module.exports = {
  DataForSeoUsage: mongoose.model("DataForSeoUsage", dataForSeoUsageSchema),
  DataForSeoMonthlySummary: mongoose.model("DataForSeoMonthlySummary", dataForSeoMonthlySummarySchema),
  DataForSeoPricing: mongoose.model("DataForSeoPricing", dataForSeoPricingSchema),
};