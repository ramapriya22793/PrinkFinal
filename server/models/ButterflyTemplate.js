const mongoose = require('mongoose');

const butterflyTemplateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  templateNumber: { type: Number },
  status: { type: String, enum: ['WAITING_FOR_SECOND_CUSTOMER', 'READY_FOR_PRINT', 'PRINTED'], default: 'WAITING_FOR_SECOND_CUSTOMER' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ButterflyTemplate', butterflyTemplateSchema);
