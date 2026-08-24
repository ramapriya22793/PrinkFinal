const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  productType: { type: String },
  thumbnail: { type: String },
  elements: [{ type: mongoose.Schema.Types.Mixed }],
  printArea: { type: mongoose.Schema.Types.Mixed },
  layoutSlots: [{ type: mongoose.Schema.Types.Mixed }],
  skuMapping: [{ type: String }],
  isDefault: { type: Boolean, default: false },
  category: { type: String },
  usageCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.Template || mongoose.model('Template', templateSchema);
