const Setting = require('../models/Setting');
const connectDB = require('./connection');

const DEFAULT_SETTINGS = {
  shopifyStore: 'prink-in.myshopify.com',
  shopifyAccessToken: '',
  notificationsEnabled: true,
  emailNotifications: true,
  dpiThreshold: 300,
  maxFileMB: 20
};

async function getSettings() {
  await connectDB();
  let settings = await Setting.findOne({}).lean();
  if (!settings) {
    settings = await Setting.create(DEFAULT_SETTINGS);
  }
  return settings;
}

async function updateSettings(updates) {
  await connectDB();
  return await Setting.findOneAndUpdate(
    {},
    updates,
    { upsert: true, returnDocument: 'after' }
  ).lean();
}

module.exports = {
  getSettings,
  updateSettings
};
