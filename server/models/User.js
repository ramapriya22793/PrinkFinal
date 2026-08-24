const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  role: { type: String, enum: ['admin', 'printer', 'customer'], default: 'customer' },
  name: { type: String },
  phone: { type: String },
  status: { type: String, default: 'active' },
  lastLogin: { type: Date }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
