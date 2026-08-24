const crypto = require('crypto');
const shopifyConfig = require('../config/shopify.config');

/**
 * Middleware for validating Shopify webhooks.
 * Extracts the x-shopify-hmac-sha256 header and matches it with the generated HMAC hash of raw body.
 */
const verifyWebhookSignature = (req, res, next) => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'] || 'orders/paid';
  const shop = req.headers['x-shopify-shop-domain'] || 'prink-in.myshopify.com';

  console.log(`\n======================================================`);
  console.log(`[WEBHOOK INCOMING] Method: ${req.method} URL: ${req.originalUrl}`);
  console.log(`[WEBHOOK HEADERS] Topic: ${topic} | Shop: ${shop}`);
  console.log(`[WEBHOOK HMAC HEADER] ${hmacHeader || 'MISSING'}`);
  
  if (process.env.BYPASS_WEBHOOK_VERIFICATION === 'true') {
    console.warn('[WEBHOOK WARNING] Webhook signature verification bypassed.');
    req.shopifyWebhook = { topic, shop };
    return next();
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || shopifyConfig.webhookSecret || shopifyConfig.apiSecret;

  if (!secret) {
    console.error('[WEBHOOK ERROR] SHOPIFY_WEBHOOK_SECRET is not configured in .env');
    return res.status(500).json({ error: 'Webhook secret is not configured' });
  }

  // Get raw body (captured by express.json({ verify }))
  const rawBody = req.rawBody;
  if (!rawBody) {
    console.warn('[WEBHOOK WARNING] req.rawBody is missing. Falling back to JSON stringify body.');
  }

  if (!rawBody) {
    // Re-serialising the parsed body does not reproduce Shopify's exact bytes,
    // so any HMAC computed from it is meaningless. Fail closed.
    console.error('[WEBHOOK ERROR] Raw body unavailable; cannot verify signature.');
    return res.status(400).json({ error: 'Raw body required for signature verification' });
  }

  if (!hmacHeader) {
    console.warn('[WEBHOOK REJECTED] Missing x-shopify-hmac-sha256 header.');
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  try {
    const generatedHash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const expected = Buffer.from(generatedHash, 'utf8');
    const received = Buffer.from(String(hmacHeader), 'utf8');

    // timingSafeEqual throws on length mismatch, so length is checked first.
    const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

    if (!valid) {
      console.warn('[WEBHOOK REJECTED] HMAC signature mismatch.');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    console.log('[WEBHOOK HMAC SUCCESS] Signature verified.');
    req.shopifyWebhook = { topic, shop };
    return next();
  } catch (err) {
    console.error(`[WEBHOOK HMAC ERROR] ${err.message}`);
    return res.status(401).json({ error: 'Webhook signature verification failed' });
  }
};

const verifySessionToken = (req, res, next) => {
  // Pass-through middleware for local development / admin session verification
  next();
};

module.exports = {
  verifyWebhookSignature,
  verifySessionToken
};

