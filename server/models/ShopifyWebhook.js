const mongoose = require('mongoose');

const ShopifyWebhookSchema = new mongoose.Schema({
  webhookId: { type: String, unique: true }, // Header X-Shopify-Webhook-Id
  topic: { type: String, required: true }, // Header X-Shopify-Topic (e.g. orders/create)
  shopDomain: { type: String, required: true }, // Header X-Shopify-Shop-Domain
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  processed: { type: Boolean, default: false },
  processedAt: { type: Date },
  errorMessage: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ShopifyWebhook', ShopifyWebhookSchema);
