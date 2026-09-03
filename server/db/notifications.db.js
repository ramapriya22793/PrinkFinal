const Notification = require('../models/Notification');

async function getNotifications(userId) {
  const query = userId ? { userId } : {};
  return await Notification.find(query).sort({ createdAt: -1 }).lean();
}

async function createNotification(data) {
  const notification = new Notification({
    id: data.id || 'notif_' + Date.now(),
    ...data
  });
  await notification.save();
  return notification.toObject();
}

async function markNotificationsRead(userId) {
  const query = userId ? { userId } : {};
  return await Notification.updateMany(query, { read: true });
}

module.exports = {
  getNotifications,
  createNotification,
  markNotificationsRead
};
