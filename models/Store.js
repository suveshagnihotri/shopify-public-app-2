const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  shopDomain: {
    type: String,
    required: true,
    index: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  scope: {
    type: String,
  },
  shopData: {
    type: mongoose.Schema.Types.Mixed,
    // Stores complete shop object from Shopify API including:
    // id, name, email, domain, country, currency, timezone, plan details,
    // payment settings, location info, and all other shop metadata
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  installedAt: {
    type: Date,
    default: Date.now,
  },
  lastAccessAt: {
    type: Date,
    default: Date.now,
  },
  uninstalledAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Index for faster queries
storeSchema.index({ shop: 1 });
storeSchema.index({ shopDomain: 1 });
storeSchema.index({ isActive: 1 });

const Store = mongoose.model('Store', storeSchema);

module.exports = Store;

