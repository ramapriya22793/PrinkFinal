const express = require('express');
const router = express.Router();
const { verifyWebhookSignature } = require('../middleware/shopify.middleware');

const ShopifyWebhook = require('../models/ShopifyWebhook');

const { processShopifyOrderWebhook } = require('../services/shopifyWebhookService');

/**
 * GET Handler (Friendly message for browser testing)
 */
router.get('/webhooks/shopify', (_req, res) => {
  res.send(`
    <html>
      <body style="font-family: sans-serif; padding: 2rem; background: #f9fafb;">
        <h2 style="color: #db2777;">Shopify Webhook Endpoint Active</h2>
        <p>This endpoint receives Shopify <strong>HTTP POST</strong> webhook events.</p>
        <p>Status: <strong>Ready to receive orders/paid webhooks!</strong></p>
      </body>
    </html>
  `);
});

/**
 * POST Handler (Receives real webhooks from Shopify)
 */
router.post('/webhooks/shopify', verifyWebhookSignature, async (req, res) => {
  const webhookId = req.headers['x-shopify-webhook-id'] || 'test_' + Date.now();
  const topic = req.shopifyWebhook?.topic || req.headers['x-shopify-topic'] || 'orders/paid';
  const shop = req.shopifyWebhook?.shop || req.headers['x-shopify-shop-domain'] || 'prink-in.myshopify.com';
  const payload = req.body || {};

  console.log(`\n------------------------------------------------------`);
  console.log(`[SHOPIFY WEBHOOK RECEIVE] Topic: ${topic} | Shop: ${shop} | ID: ${webhookId}`);
  console.log(`[SHOPIFY WEBHOOK PAYLOAD]`, JSON.stringify(payload).substring(0, 300) + '...');

  let result = null;
  try {
    // Idempotency: Shopify retries a webhook until it gets a 200, and may send
    // the same delivery more than once. Claim the webhook id first - the unique
    // index makes this atomic - so a retry is acknowledged without reprocessing.
    let claimed = true;
    try {
      await ShopifyWebhook.create({
        webhookId,
        topic,
        shopDomain: shop,
        payload,
        processed: false
      });
    } catch (e) {
      if (e.code === 11000) {
        claimed = false;
        console.log(`[SHOPIFY WEBHOOK] Duplicate delivery ${webhookId} ignored.`);
      } else {
        console.log('[DB LOG SKIPPED]', e.message);
      }
    }

    if (claimed && payload && (payload.id || payload.order_number)) {
      result = await processShopifyOrderWebhook(payload, topic);
      await ShopifyWebhook.updateOne(
        { webhookId },
        { $set: { processed: true, processedAt: new Date() } }
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[SHOPIFY WEBHOOK ERROR]', err.message);
    await ShopifyWebhook.updateOne(
      { webhookId },
      { $set: { errorMessage: err.message } }
    ).catch(() => {});
  }

  console.log(`[SHOPIFY WEBHOOK RESPONSE] Sending 200 OK to Shopify`);
  console.log(`------------------------------------------------------\n`);
  return res.status(200).json({
    success: true,
    message: 'Webhook processed successfully',
    order: result?.order,
    uploadLink: result?.uploadLink
  });
});

/**
 * POST Handler for Mock Webhook (Convenience test endpoint)
 */
router.post('/shopify/mock-webhook', async (req, res) => {
  try {
    const mockPayload = req.body && req.body.id ? req.body : {
      id: 9988776655,
      order_number: 1042,
      name: `#ORD-1042-${Date.now().toString().slice(-4)}`,
      email: 'customer@example.com',
      total_price: '1499.00',
      financial_status: 'paid',
      created_at: new Date().toISOString(),
      customer: {
        id: 123456789,
        first_name: 'Rahul',
        last_name: 'Sharma',
        email: 'customer@example.com',
        phone: '+919876543210'
      },
      shipping_address: {
        name: 'Rahul Sharma',
        address1: '123 Main Street',
        city: 'Mumbai',
        province: 'Maharashtra',
        country: 'India',
        zip: '400001',
        phone: '+919876543210'
      },
      line_items: [
        {
          id: 55443322,
          product_id: 11223344,
          variant_id: 66778899,
          title: 'Custom Photo Frame 8x10',
          quantity: 1,
          price: '1499.00',
          sku: 'FRAME-8X10'
        }
      ]
    };

    const result = await processShopifyOrderWebhook(mockPayload, 'orders/create');
    return res.json({
      success: true,
      message: 'Mock webhook processed successfully',
      order: result.order,
      whatsapp: {
        uploadLink: result.uploadLink
      }
    });
  } catch (err) {
    console.error('[MOCK WEBHOOK ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

