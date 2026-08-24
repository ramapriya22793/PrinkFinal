const mongoose = require('mongoose');

const butterflyTemplateSlotSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  templateId: { type: String, required: true, index: true },
  side: { type: String, enum: ['BLUE', 'RED'], required: true },
  orderId: { type: String, required: true, index: true },
  customerId: { type: String },
  status: { type: String, enum: ['FILLED'], default: 'FILLED' },
  assignedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ButterflyTemplateSlot', butterflyTemplateSlotSchema);
