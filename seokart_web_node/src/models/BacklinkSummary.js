const mongoose = require("mongoose");

const backlinkDataSchema = new mongoose.Schema(
  {
    backlink_summary_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BacklinkSummary",
      required: true,
      index: true
    },
    url_from: { 
      type: String, 
      required: true, 
      maxlength: 1000,
      trim: true
    },
    url_to: { 
      type: String, 
      required: true, 
      maxlength: 1000,
      trim: true
    },
    title: { 
      type: String, 
      maxlength: 500,
      default: "",
      trim: true
    },
    anchor: { 
      type: String, 
      maxlength: 500,
      default: "",
      trim: true
    },
    alt: { 
      type: String, 
      maxlength: 500,
      default: "",
      trim: true
    },
    nofollow: { 
      type: Boolean, 
      default: false 
    },
    image: { 
      type: Boolean, 
      default: false 
    },
    image_source: { 
      type: String, 
      maxlength: 1000,
      default: "",
      trim: true
    },
    inlink_rank: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    domain_inlink_rank: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    first_seen: { 
      type: String, 
      maxlength: 50,
      trim: true
    },
    last_visited: { 
      type: String, 
      maxlength: 50,
      trim: true
    }
  },{
    timestamps: true
  }
);

const BacklinkDataModel = mongoose.model("BacklinkData", backlinkDataSchema);

const BacklinkSummarySchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true 
    },
    websiteUrl: { 
      type: String, 
      required: true, 
      index: true,
      trim: true,
      lowercase: true
    },
    target: { 
      type: String, 
      trim: true 
    },
    
    // Processing status
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
      index: true
    },
    
    // Summary metrics from get-summary API
    backlinks: { type: Number, default: 0, min: 0 },
    refdomains: { type: Number, default: 0, min: 0 },
    subnets: { type: Number, default: 0, min: 0 },
    ips: { type: Number, default: 0, min: 0 },
    nofollow_backlinks: { type: Number, default: 0, min: 0 },
    dofollow_backlinks: { type: Number, default: 0, min: 0 },
    inlink_rank: { type: Number, default: 0, min: 0 },
    anchors: { type: Number, default: 0, min: 0 },
    edu_backlinks: { type: Number, default: 0, min: 0 },
    gov_backlinks: { type: Number, default: 0, min: 0 },
    domain_inlink_rank: { type: Number, default: 0, min: 0 },
    from_home_page_backlinks: { type: Number, default: 0, min: 0 },
    dofollow_from_home_page_backlinks: { type: Number, default: 0, min: 0 },
    text_backlinks: { type: Number, default: 0, min: 0 },
    dofollow_refdomains: { type: Number, default: 0, min: 0 },
    from_home_page_refdomains: { type: Number, default: 0, min: 0 },
    edu_refdomains: { type: Number, default: 0, min: 0 },
    gov_refdomains: { type: Number, default: 0, min: 0 },
    dofollow_anchors: { type: Number, default: 0, min: 0 },
    pages_with_backlinks: { type: Number, default: 0, min: 0 },
    
    // Individual backlinks from get-backlinks API (limit 100)
    // backlinks_data: [{
    //   url_from: { 
    //     type: String, 
    //     required: true, 
    //     maxlength: 1000,
    //     trim: true
    //   },
    //   url_to: { 
    //     type: String, 
    //     required: true, 
    //     maxlength: 1000,
    //     trim: true
    //   },
    //   title: { 
    //     type: String, 
    //     maxlength: 500,
    //     default: "",
    //     trim: true
    //   },
    //   anchor: { 
    //     type: String, 
    //     maxlength: 500,
    //     default: "",
    //     trim: true
    //   },
    //   alt: { 
    //     type: String, 
    //     maxlength: 500,
    //     default: "",
    //     trim: true
    //   },
    //   nofollow: { 
    //     type: Boolean, 
    //     default: false 
    //   },
    //   image: { 
    //     type: Boolean, 
    //     default: false 
    //   },
    //   image_source: { 
    //     type: String, 
    //     maxlength: 1000,
    //     default: "",
    //     trim: true
    //   },
    //   inlink_rank: { 
    //     type: Number, 
    //     default: 0, 
    //     min: 0 
    //   },
    //   domain_inlink_rank: { 
    //     type: Number, 
    //     default: 0, 
    //     min: 0 
    //   },
    //   first_seen: { 
    //     type: String, 
    //     maxlength: 50,
    //     trim: true
    //   },
    //   last_visited: { 
    //     type: String, 
    //     maxlength: 50,
    //     trim: true
    //   }
    // }],
    
    // API metadata
    lastFetched: { 
      type: Date, 
      index: true 
    },
    apiResponseTime: { type: Number, min: 0 },
    summaryApiTime: { type: Number, min: 0 },
    backlinksApiTime: { type: Number, min: 0 },
    apiStatus: { 
      type: String, 
      enum: ["success", "failed", "partial"], 
      default: "success" 
    },
    errorMessage: { type: String, maxlength: 1000, trim: true },
    
    // Processing timestamps
    processingStarted: { type: Date, default: Date.now },
    processingCompleted: { type: Date }
  },
  { 
    timestamps: true
  }
);

// Compound indexes for better query performance
BacklinkSummarySchema.index({ userId: 1, websiteUrl: 1 }, { unique: true });
BacklinkSummarySchema.index({ userId: 1, status: 1 });
BacklinkSummarySchema.index({ userId: 1, lastFetched: -1 });

// Check if data is fresh (within 7 days)
BacklinkSummarySchema.virtual('isFresh').get(function() {
  if (this.status !== 'completed') return false;
  const cacheDuration = (process.env.BACKLINK_CACHE_DURATION_DAYS || 7) * 24 * 60 * 60 * 1000;
  return this.lastFetched && (Date.now() - this.lastFetched.getTime()) < cacheDuration;
});

// Data age in hours
BacklinkSummarySchema.virtual('ageInHours').get(function() {
  if (!this.lastFetched) return null;
  return Math.round((Date.now() - this.lastFetched.getTime()) / (1000 * 60 * 60));
});

// Processing duration in seconds
BacklinkSummarySchema.virtual('processingDuration').get(function() {
  if (!this.processingStarted) return null;
  const endTime = this.processingCompleted || Date.now();
  return Math.round((endTime - this.processingStarted.getTime()) / 1000);
});

// Get dashboard summary stats
BacklinkSummarySchema.methods.getDashboardStats = function() {
  return {
    websiteUrl: this.websiteUrl,
    target: this.target,
    status: this.status,
    totalBacklinks: this.backlinks,
    totalRefdomains: this.refdomains,
    dofollowBacklinks: this.dofollow_backlinks,
    nofollowBacklinks: this.nofollow_backlinks,
    dofollowRatio: this.backlinks > 0 ? Math.round((this.dofollow_backlinks / this.backlinks) * 100) : 0,
    eduBacklinks: this.edu_backlinks,
    govBacklinks: this.gov_backlinks,
    // individualBacklinksCount: this.backlinks_data ? this.backlinks_data.length : 0,
    lastUpdated: this.lastFetched,
    ageInHours: this.ageInHours,
    isFresh: this.isFresh,
    processingDuration: this.processingDuration,
    errorMessage: this.errorMessage,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Transform output to include virtuals
BacklinkSummarySchema.set('toJSON', { 
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

BacklinkSummarySchema.set('toObject', { virtuals: true });

const BacklinkSummary = mongoose.model("BacklinkSummary", BacklinkSummarySchema);
module.exports = BacklinkSummary;
module.exports.BacklinkDataModel = BacklinkDataModel;