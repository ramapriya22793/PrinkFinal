const shopifyConfig = require('../config/shopify.config');
const shopifyService = require('../services/shopify.service');

/**
 * Scheduled jobs to sync products, orders, and customers from Shopify to MongoDB.
 * Uses node-cron if available, else falls back to setInterval.
 */
let cron;
try {
  cron = require('node-cron');
} catch (e) {
  console.warn('[JOBS SYSTEM] node-cron package not installed. Falling back to setInterval.');
}

const startScheduledSyncJobs = () => {
  const shop = shopifyConfig.store;
  const token = shopifyConfig.accessToken;

  if (!token || token === 'your_access_token_here' || token.includes('your_admin_access_token_here')) {
    console.log('[JOBS SYSTEM] Shopify sync jobs disabled: Placeholder credentials detected.');
    return;
  }

  const runSyncWorkflows = async () => {
    try {
      console.log('[JOBS SYSTEM] Starting scheduled dataset sync...');
      await shopifyService.runFullProductSync(shop, token);
      await shopifyService.runFullOrderSync(shop, token);
      await shopifyService.runFullCustomerSync(shop, token);
      console.log('[JOBS SYSTEM] Scheduled dataset sync completed successfully.');
    } catch (err) {
      console.error('[JOBS SYSTEM ERROR] Synchronization job failed:', err.message);
    }
  };

  if (cron) {
    // Run every day at midnight: '0 0 * * *'
    // For test/dev, we can set it to run hourly: '0 * * * *'
    cron.schedule('0 * * * *', () => {
      console.log('[CRON JOB] Running hourly Shopify sync job...');
      runSyncWorkflows();
    });
    console.log('[JOBS SYSTEM] Cron job scheduled to sync hourly.');
  } else {
    // Fallback: Run every 6 hours
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    setInterval(() => {
      console.log('[INTERVAL JOB] Running periodic Shopify sync job...');
      runSyncWorkflows();
    }, SIX_HOURS);
    console.log('[JOBS SYSTEM] Interval scheduler started (runs every 6 hours).');
  }

  // Run once immediately on startup
  setTimeout(() => {
    console.log('[JOBS SYSTEM] Running initial startup synchronization...');
    runSyncWorkflows();
  }, 5000);
};

module.exports = {
  startScheduledSyncJobs
};
