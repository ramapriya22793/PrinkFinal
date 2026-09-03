const mongoose = require('mongoose');

const designSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String },
  orderId: { type: String },
  name: { type: String, default: 'Untitled Design' },
  elements: [{ type: mongoose.Schema.Types.Mixed }],
  thumbnail: { type: String },
  status: { type: String, default: 'draft' }
}, { timestamps: true });

module.exports = mongoose.models.Design || mongoose.model('Design', designSchema);
