const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  shop: {
    type: String,
    required: true,
    index: true,
  },
  state: {
    type: String,
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  scope: {
    type: String,
  },
  expires: {
    type: Date,
  },
  accessToken: {
    type: String,
  },
  userId: {
    type: String,
  },
  sessionData: {
    type: mongoose.Schema.Types.Mixed,
  },
}, {
  timestamps: true,
});

// Index for faster queries
sessionSchema.index({ shop: 1, id: 1 });
sessionSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;

