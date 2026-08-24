const Order = require('../models/Order');

async function getOrders(query = {}) {
  return await Order.find(query)
    .sort({ createdAt: -1 })
    .lean();
}

async function getOrderById(id) {
  return await Order.findOne({ id }).lean();
}

async function getOrderByShopifyId(shopifyId) {
  return await Order.findOne({ shopifyId }).lean();
}

async function getOrderByUploadToken(uploadToken) {
  return await Order.findOne({ uploadToken }).lean();
}

async function createOrder(orderData) {
  const orderId = orderData.id || 'ORD' + Date.now();
  const existing = await Order.findOne({ id: orderId });
  if (existing) {
    return existing.toObject();
  }

  const order = new Order({
    id: orderId,
    ...orderData
  });
  await order.save();
  return order.toObject();
}

async function upsertOrder(query, orderData) {
  return await Order.findOneAndUpdate(
    query,
    { $set: orderData },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function updateOrder(id, updates) {
  return await Order.findOneAndUpdate({ id }, updates, { new: true }).lean();
}

async function addActivityLog(id, type, text) {
  return await Order.findOneAndUpdate(
    { id },
    { $push: { activityLogs: { type, text, timestamp: new Date() } } },
    { new: true }
  ).lean();
}

async function deleteOrderById(id) {
  return await Order.deleteOne({ id });
}

async function deleteOrdersByPhone(phone) {
  return await Order.deleteMany({ 'customer.phone': phone });
}

module.exports = {
  getOrders,
  getOrderById,
  getOrderByShopifyId,
  getOrderByUploadToken,
  createOrder,
  upsertOrder,
  updateOrder,
  addActivityLog,
  deleteOrderById,
  deleteOrdersByPhone
};

