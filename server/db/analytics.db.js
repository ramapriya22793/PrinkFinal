const Order = require('../models/Order');

async function getOrderAnalytics() {
  const totalOrders = await Order.countDocuments();
  const fulfilledOrders = await Order.countDocuments({ deliveryStatus: 'fulfilled' });
  const pendingOrders = await Order.countDocuments({ deliveryStatus: 'unfulfilled' });
  const inPrintQueue = await Order.countDocuments({ printStatus: 'queued' });

  return {
    totalOrders,
    fulfilledOrders,
    pendingOrders,
    inPrintQueue
  };
}

module.exports = {
  getOrderAnalytics
};
