const Setting = require('../models/Setting');

const DEFAULT_SETTINGS = {
  shopifyStore: 'prink-in.myshopify.com',
  shopifyAccessToken: '',
  notificationsEnabled: true,
  emailNotifications: true,
  dpiThreshold: 300,
  maxFileMB: 20
};

async function getSettings() {
  let settings = await Setting.findOne({}).lean();
  if (!settings) {
    settings = await Setting.create(DEFAULT_SETTINGS);
  }
  return settings;
}

async function updateSettings(updates) {
  return await Setting.findOneAndUpdate(
    {},
    updates,
    { upsert: true, new: true }
  ).lean();
}

module.exports = {
  getSettings,
  updateSettings
};
