const mongoose = require('mongoose');

// Temporary debug route - remove after testing
module.exports = async (req, res) => {
  try {
    const Order = require('./models/Order');
    
    // Find all orders
    const allOrders = await Order.find({}).sort({ createdAt: -1 }).lean();
    
    // Find order 184950 specifically
    const order184950 = await Order.findOne({
      $or: [
        { shopifyId: '7281340711141' },
        { id: { $regex: '184950' } }
      ]
    }).lean();

    // Find Shivsagar's order
    const shivsagarOrder = await Order.findOne({
      $or: [
        { 'customer.email': 'shvsgrdhb9@gmail.com' },
        { shopifyId: '7227060158693' }
      ]
    }).lean();

    res.json({
      totalOrders: allOrders.length,
      allOrderIds: allOrders.map(o => ({ id: o.id, shopifyId: o.shopifyId, email: o.customer?.email, name: o.customer?.name })),
      order184950: order184950 ? { id: order184950.id, shopifyId: order184950.shopifyId } : 'NOT FOUND',
      shivsagarOrder: shivsagarOrder ? { id: shivsagarOrder.id, shopifyId: shivsagarOrder.shopifyId, status: shivsagarOrder.uploadStatus } : 'NOT FOUND'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
