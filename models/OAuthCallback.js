const mongoose = require('mongoose');

const oauthCallbackSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  hmac: {
    type: String,
  },
  host: {
    type: String,
  },
  timestamp: {
    type: String,
  },
  callbackData: {
    type: mongoose.Schema.Types.Mixed,
    // Stores complete callback query parameters and response data
  },
  sessionId: {
    type: String,
    index: true,
  },
  success: {
    type: Boolean,
    default: true,
  },
  error: {
    type: String,
  },
}, {
  timestamps: true,
});

// Index for faster queries
oauthCallbackSchema.index({ shop: 1, createdAt: -1 });
oauthCallbackSchema.index({ sessionId: 1 });
oauthCallbackSchema.index({ success: 1 });

const OAuthCallback = mongoose.model('OAuthCallback', oauthCallbackSchema);

module.exports = OAuthCallback;

