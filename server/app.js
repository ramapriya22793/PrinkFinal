const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const shopifyConfig = require('./config/shopify.config');
const shopifyRoutes = require('./routes/shopify.routes');
const webhookRoutes = require('./webhooks/shopify.webhooks');
const { startScheduledSyncJobs } = require('./jobs/sync');

const app = express();

// 1. CORS Setup
app.use(cors());

// 2. Body Parsers with Raw Body Capture (Needed for Shopify Webhook HMAC Signature verification)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // Capture raw buffer
  }
}));
app.use(express.urlencoded({ extended: true }));

// 3. Mount Routes
app.use('/api/shopify', shopifyRoutes);
app.use('/api', webhookRoutes); // Mounts /api/webhooks/shopify

// 4. Default Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 5. Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER GLOBAL ERROR]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    status
  });
});

// 6. Connect to MongoDB and start jobs
mongoose.connect(shopifyConfig.mongodbUri)
  .then(() => {
    console.log(`[DATABASE] Connected to MongoDB at ${shopifyConfig.mongodbUri}`);
    // Start background sync tasks
    startScheduledSyncJobs();
  })
  .catch(err => {
    console.error('[DATABASE CONNECT ERROR]', err.message);
  });

module.exports = app;
