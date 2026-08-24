const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shopifyProductId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  handle: { type: String },
  productType: { type: String },
  variants: [{ type: mongoose.Schema.Types.Mixed }],
  images: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
