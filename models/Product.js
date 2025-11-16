const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true,
  },
  productId: {
    type: Number,
    required: true,
    index: true,
  },
  shopifyProductId: {
    type: Number,
    required: true,
    unique: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    index: true,
  },
  vendor: {
    type: String,
    index: true,
  },
  productType: {
    type: String,
    index: true,
  },
  handle: {
    type: String,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'draft'],
    default: 'active',
  },
  productData: {
    type: mongoose.Schema.Types.Mixed,
    // Stores complete product object from Shopify API including:
    // variants, images, options, tags, metafields, etc.
  },
  syncedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Index for faster queries
productSchema.index({ shop: 1, productId: 1 });
productSchema.index({ shop: 1, status: 1 });
productSchema.index({ shop: 1, createdAt: -1 });
productSchema.index({ title: 'text', vendor: 'text', productType: 'text' }); // Text search index

const Product = mongoose.model('Product', productSchema);

module.exports = Product;

