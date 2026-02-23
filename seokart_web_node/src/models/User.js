const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // password: {
    //   type: String,
    //   required: function() {
    //     return this.provider === 'email';
    //   }
    // },
    provider: {
      type: String,
      enum: ["bigcommerce", "shopify"],
      default: "bigcommerce",
    },
    store_hash: {
      type: String,
      index: true,
      required: true,
      unique: true,
    },
    store_id: {
      type: String,
    },
    access_token: {
      type: String,
      default: null,
    },
    scope: {
      type: String,
      default: null,
    },
    profilePicture: {
      type: String,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
    // New fields for plan selection
    hasCompletedSetup: {
      type: Boolean,
      default: false,
    },
    selectedPlan: {
      type: String,
      enum: ["free", "basic", "pro", "enterprise"],
      default: null,
    },
    primaryDomain: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    lastInstalledAt: {
      type: Date,
      default: null,
    },
    lastUninstalledAt: {
      type: Date,
      default: null,
    },
    installStatus: {
      type: String,
      enum: ["installed", "uninstalled", "unknown"],
      default: "unknown",
    },
  },
  {
    timestamps: true,
  }
);

// Update last login
UserSchema.methods.updateLastLogin = async function () {
  this.lastLogin = new Date();
  return this.save();
};

// Check if user needs to complete setup
UserSchema.methods.needsSetup = function () {
  return !this.hasCompletedSetup || !this.selectedPlan || !this.primaryDomain;
};

module.exports = mongoose.model("User", UserSchema);
