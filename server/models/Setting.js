const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  shopifyStore: { type: String },
  shopifyAccessToken: { type: String },
  notificationsEnabled: { type: Boolean, default: true },
  emailNotifications: { type: Boolean, default: true },
  dpiThreshold: { type: Number, default: 300 },
  maxFileMB: { type: Number, default: 50 },
  googleSheetId: { type: String, default: '1klYTlNaHAZGzJpdEYwcOi1AalQYem7RNOpAj1S0mVOg' },
  googleCredentialsJson: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
