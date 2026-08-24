const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // For dispatched customer messages this is the dedupe key (see
  // services/notification.service.js). The unique index is what makes
  // "send exactly once" atomic rather than best-effort.
  id: { type: String, required: true, unique: true },
  userId: { type: String },
  orderId: { type: String, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  type: { type: String, default: 'info' },
  status: { type: String, default: 'pending' }, // pending | sent | recorded | failed
  channel: { type: String },                    // whatsapp | recorded
  error: { type: String },
  sentAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
