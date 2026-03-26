const mongoose = require("mongoose");

const ALLOWED_CHANNEL_TYPES = [
  "storefront",
  "marketplace",
  "social",
  "pos",
  "headless",
  "custom",
  "unknown",
];

const ALLOWED_CHANNEL_STATUSES = ["active", "inactive", "archived", "unknown"];

const channelSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    store_hash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    channel_id: {
      type: Number,
      required: true,
      min: 1,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    type: {
      type: String,
      enum: ALLOWED_CHANNEL_TYPES,
      default: "unknown",
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALLOWED_CHANNEL_STATUSES,
      default: "unknown",
      lowercase: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      trim: true,
      lowercase: true,
      default: "bigcommerce",
      immutable: true,
      index: true,
    },
    is_primary: {
      type: Boolean,
      default: false,
      index: true,
    },
    date_created: {
      type: Date,
      default: null,
    },
    date_modified: {
      type: Date,
      default: null,
    },
    storefront_url: {
      type: String,
      trim: true,
      default: null,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false,
    },
    syncedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

channelSchema.index({ store_hash: 1, channel_id: 1 }, { unique: true });
channelSchema.index({ userId: 1, store_hash: 1 });
channelSchema.index({ store_hash: 1, status: 1, isDeleted: 1 });
channelSchema.index({ syncedAt: -1 });

channelSchema.pre("validate", function (next) {
  if (this.type && !ALLOWED_CHANNEL_TYPES.includes(this.type)) {
    this.type = "unknown";
  }

  if (this.status && !ALLOWED_CHANNEL_STATUSES.includes(this.status)) {
    this.status = "unknown";
  }

  if (this.name) {
    this.name = this.name.trim();
  }

  if (this.store_hash) {
    this.store_hash = this.store_hash.trim().toLowerCase();
  }

  next();
});

module.exports = mongoose.model("Channel", channelSchema);
