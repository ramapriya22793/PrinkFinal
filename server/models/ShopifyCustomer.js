const mongoose = require('mongoose');

const ShopifyCustomerSchema = new mongoose.Schema({
  shopifyCustomerId: { type: String, required: true, unique: true },
  email: { type: String },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  ordersCount: { type: Number, default: 0 },
  totalSpent: { type: String, default: '0.00' },
  state: { type: String },
  verifiedEmail: { type: Boolean, default: false },
  rawJson: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

ShopifyCustomerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShopifyCustomer', ShopifyCustomerSchema);
