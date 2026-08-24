require('./utils/dns-fix');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { connectDB } = require('./db/connection');

// Import modular routes
const authRoutes = require('./routes/auth.routes');
const orderRoutes = require('./routes/order.routes');
const productRoutes = require('./routes/product.routes');
const skuRoutes = require('./routes/sku.routes');
const designRoutes = require('./routes/design.routes');
const templateRoutes = require('./routes/template.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const printerRoutes = require('./routes/printer.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const paymentRoutes = require('./routes/payment.routes');
const addressRoutes = require('./routes/address.routes');
const notificationRoutes = require('./routes/notification.routes');
const settingsRoutes = require('./routes/settings.routes');
const uploadRoutes = require('./routes/upload.routes');
const couponRoutes = require('./routes/coupon.routes');
const userRoutes = require('./routes/user.routes');
const customerRoutes = require('./routes/customer.routes');

const publicUploadRoutes = require('./routes/publicUpload.routes');

const shopifyRoutes = require('./routes/shopify.routes');
const webhookRoutes = require('./webhooks/shopify.webhooks');


const app = express();
const PORT = process.env.PORT || 5000;

// Global Request Logger Middleware & Connection Assurance
app.use(async (req, _res, next) => {
  console.log(`[REQUEST LOG] ${new Date().toISOString()} | Method: ${req.method} | Path: ${req.originalUrl}`);
  try {
    await connectDB();
  } catch (e) {
    console.error('[DB CONNECT ERROR]', e.message);
  }
  next();
});

// Security headers. crossOriginResourcePolicy is relaxed so the separate
// frontend origins can load /uploads images; CSP is left to the frontend hosts.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Enable CORS. `credentials` only has meaning with an explicit origin list;
// combining it with '*' is rejected by browsers, so allowed origins are
// configurable and default to the local app ports.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,https://admin.theprink.in,https://customer.theprink.in,https://printer.theprink.in')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Same-origin/server-to-server requests send no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    
    // Allow any subdomain of theprink.in or vercel.app for hosting resilience
    try {
      const url = new URL(origin);
      if (
        url.hostname === 'theprink.in' || 
        url.hostname.endsWith('.theprink.in') || 
        url.hostname.endsWith('.vercel.app')
      ) {
        return cb(null, true);
      }
    } catch (e) {}

    return cb(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true
}));

// Body Parsers with Raw Body Capture (Needed for Shopify Webhook HMAC Signature verification)
app.use(express.json({ limit: '500mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// Serve static uploaded files.
// On serverless environments (like Vercel), dynamically generated files are saved to the OS temp folder.
// This middleware first tries to serve files from the local uploads folder, falls back to os.tmpdir() if not found,
// and finally attempts to restore files from GridFS if they were lost due to container recycling/redeploys.
const os = require('os');
const fs = require('fs');

// In-memory cache of GridFS file metadata to avoid repeated DB queries per image request
const gridFSMetaCache = new Map();

app.use('/uploads', async (req, res, next) => {
  const relPath = req.path;
  const filename = path.basename(relPath);

  // Ensure DB is connected before serving (critical for Vercel cold starts)
  try { await connectDB(); } catch (_e) { /* will fail gracefully below */ }

  // Set long-term cache headers for images to eliminate repeat loading delays
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Accept-Encoding');

  const localFile = path.join(__dirname, 'uploads', relPath);
  if (fs.existsSync(localFile) && fs.statSync(localFile).isFile()) {
    return res.sendFile(localFile);
  }
  
  // Try OS tmp directory (flat structure)
  const tmpFile = path.join(os.tmpdir(), filename);
  if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).isFile()) {
    return res.sendFile(tmpFile);
  }
  
  // Fast Fallback: Stream directly from GridFS in Mongo
  try {
    const { streamFromGridFSToResponse } = require('./utils/dbStorage');
    const mongoose = require('mongoose');

    // Use metadata cache to avoid querying MongoDB on every image request
    let fileMeta = gridFSMetaCache.get(filename);
    if (!fileMeta && mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      const files = await mongoose.connection.db.collection('uploads.files').find({ filename }).limit(1).toArray();
      if (files.length > 0) {
        fileMeta = files[0];
        gridFSMetaCache.set(filename, fileMeta);
        // Cap cache size to 500 entries to avoid memory bloat
        if (gridFSMetaCache.size > 500) {
          gridFSMetaCache.delete(gridFSMetaCache.keys().next().value);
        }
      }
    }

    if (fileMeta) {
      // Set ETag and Last-Modified so browser uses 304 cache on repeat loads
      const etag = `"${fileMeta._id.toString()}"`;
      const lastModified = fileMeta.uploadDate ? new Date(fileMeta.uploadDate).toUTCString() : null;
      if (lastModified) res.setHeader('Last-Modified', lastModified);
      res.setHeader('ETag', etag);
      if (fileMeta.length) res.setHeader('Content-Length', fileMeta.length);

      // Return 304 Not Modified if browser already has this version cached
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      const streamed = await streamFromGridFSToResponse(filename, res);
      if (streamed) return;
    }

    // If exact filename wasn't found in GridFS (e.g. preview requested but only original exists), try original
    if (filename.startsWith('prev_')) {
      const origFilename = filename.replace('prev_', '');
      const streamed = await streamFromGridFSToResponse(origFilename, res);
      if (streamed) return;
    }
  } catch (gridfsErr) {
    console.error(`[GridFS Serving Error] for ${filename}:`, gridfsErr.message);
  }

  next();
});

// DB Connection Middleware — ensures every API request has a live DB connection.
// Critical for Vercel serverless where each invocation is a cold start.
app.use('/api', async (_req, res, next) => {
  // Prevent Vercel Edge Cache from caching any API responses.
  // Without this, GET /api/orders can return a stale (empty) cached response
  // that bypasses the serverless function entirely (shown as ◇ in Vercel logs).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  try {
    await connectDB();
  } catch (e) {
    console.error('[DB MIDDLEWARE] Could not connect to database:', e.message);
  }
  next();
});

// Mount Webhook & API Routes
app.use('/api', webhookRoutes); // Mounts POST /api/webhooks/shopify
app.use('/api/public', publicUploadRoutes); // Token-authenticated customer upload portal
app.use('/api/shopify', shopifyRoutes);
app.use('/api/auth', authRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/skus', skuRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/printer', printerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/settings', settingsRoutes);
// Both spellings are mounted: the admin editor calls /api/uploads while other
// callers use /api/upload. One router serves both rather than 404-ing one.
app.use('/api/upload', uploadRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/coupon', couponRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);

// Serverless Cron Sync Endpoint — daily Shopify data pull + Google Sheets update
app.get('/api/cron/sync', async (req, res) => {
  // Optional security check: verify Vercel Cron Header or query secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[CRON ERROR] Unauthorized cron trigger request');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { connectDB } = require('./db/connection');
    await connectDB();

    const db = require('./db');
    const settings = await db.getSettings();
    const shop = settings.shopifyStore || process.env.SHOPIFY_STORE;
    const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!token || token === 'your_access_token_here' || token.includes('your_admin_access_token_here')) {
      return res.status(400).json({ success: false, error: 'Shopify credentials not configured.' });
    }

    const shopifyService = require('./services/shopify.service');
    console.log('[CRON] Starting automated daily Shopify & Google Sheets sync...');
    
    // Sync products and customers
    await shopifyService.runFullProductSync(shop, token);
    await shopifyService.runFullCustomerSync(shop, token);
    
    // Sync recent orders (last 48 hours) to prevent serverless execution timeout
    const result = await shopifyService.runRecentOrderSync(shop, token);

    // Also push any unsynced orders to Google Sheets
    const sheetsResult = await require('./services/googleSheetService').syncAllUnsyncedOrdersToSheet();

    res.json({
      success: true,
      message: 'Shopify & Google Sheets sync completed successfully',
      syncedOrdersCount: result.count,
      sheetsSyncedCount: sheetsResult.count
    });
  } catch (err) {
    console.error('[CRON ERROR] Sync failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual Admin Endpoint — backfill ALL orders from DB to Google Sheets
// Call: GET https://api.theprink.in/api/sheets/sync-all
app.get('/api/sheets/sync-all', async (req, res) => {
  try {
    await connectDB();
    console.log('[SHEETS BACKFILL] Admin triggered full Google Sheets sync...');
    const { syncAllUnsyncedOrdersToSheet } = require('./services/googleSheetService');
    const result = await syncAllUnsyncedOrdersToSheet();
    res.json({
      success: true,
      message: `Google Sheets backfill complete. ${result.count} orders synced.`,
      ...result
    });
  } catch (err) {
    console.error('[SHEETS BACKFILL ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health Check Endpoint
app.get('/api/health', async (_req, res) => {
  // On Vercel serverless, we must await the DB connection before checking state
  try {
    await connectDB();
  } catch (e) {
    // ignore - we'll report degraded below
  }
  const mongoose = require('mongoose');
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    database: dbUp ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
    service: 'THE PRINK API Server'
  });
});


// Google Sheets Test Endpoint
app.get('/api/test/sheets', async (_req, res) => {
  try {
    const { getSheetsClient } = require('./services/googleSheetService');
    const client = await getSheetsClient();
    if (!client) {
      return res.status(500).json({ success: false, message: 'Missing credentials or client failed to initialize' });
    }
    if (client === 'mock') {
      return res.json({ success: true, message: 'Mock mode is active. Please replace MOCK_KEY_REPLACE_ME in google-credentials.json with the real private key.' });
    }
    // Attempt a basic fetch to verify connection
    const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ success: false, message: 'GOOGLE_SHEET_ID is missing from .env' });
    }
    const response = await client.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    res.json({ success: true, message: 'Successfully connected to Google Sheets API', sheetTitle: response.data.properties.title });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Google API Connection failed', error: err.message });
  }
});

// Root Endpoint
app.get('/', (_req, res) => {
  res.send('<h1>THE PRINK API Server</h1><p>API is running cleanly and modularly.</p>');
});

app.get('/api/product-configs', (_req, res) => {
  res.json({ success: true, configs: {} });
});


// Error Handling Middleware.
// Internal 5xx details are logged but never returned: a raw message can carry
// file paths, connection strings or driver internals. Deliberate 4xx errors
// keep their message because they are written for the user.
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error('[SERVER ERROR]', req.method, req.originalUrl, err.stack || err.message);

  if (status >= 500) {
    return res.status(status).json({
      success: false,
      error: 'Something went wrong on our side. Please try again.'
    });
  }
  res.status(status).json({ success: false, error: err.message || 'Request failed' });
});

// A rejected promise with no handler must not take the process down mid-request.
process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// Connect DB & Start Server
connectDB(); // Ensure DB connects in Vercel serverless environment

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  THE PRINK - Express Backend Server`);
    console.log(`  Server running on http://localhost:${PORT}`);
    console.log(`  Webhook Endpoint: POST http://localhost:${PORT}/api/webhooks/shopify`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
