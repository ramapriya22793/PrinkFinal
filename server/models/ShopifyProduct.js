const mongoose = require('mongoose');

const ShopifyProductSchema = new mongoose.Schema({
  shopifyProductId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  bodyHtml: { type: String },
  vendor: { type: String },
  productType: { type: String },
  handle: { type: String, required: true },
  status: { type: String, default: 'active' },
  variants: [
    {
      variantId: { type: String, required: true },
      title: { type: String },
      price: { type: String },
      sku: { type: String },
      inventoryItemId: { type: String },
      inventoryQuantity: { type: Number, default: 0 }
    }
  ],
  images: [{ type: String }],
  rawJson: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('ShopifyProduct', ShopifyProductSchema);
