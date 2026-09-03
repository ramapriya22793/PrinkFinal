const mongoose = require('mongoose');

const skuSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  category: { type: String, default: 'General' },
  productType: { type: String, required: true, default: 'mug' },
  requiresCustomization: { type: Boolean, default: true },
  requiredPhotoCount: { type: Number, default: 1 },
  supportedImageCount: { type: Number, default: 1 },
  customizationRules: { type: String, default: 'Standard Image Upload' },
  printTemplate: { type: String, default: 'Standard Print Template' },
  templateId: { type: String },
  templateName: { type: String },
  printAreaWidth: { type: Number },
  printAreaHeight: { type: Number },
  orientation: { type: String, default: 'portrait' },
  printingInstructions: { type: String },
  supportedFileTypes: [{ type: String, default: ['JPG', 'PNG', 'WEBP'] }],
  status: { type: String, default: 'active' }
}, { timestamps: true });

module.exports = mongoose.models.SKU || mongoose.model('SKU', skuSchema);
