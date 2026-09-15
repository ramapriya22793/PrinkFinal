require('../utils/dns-fix');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { connectDB } = require('../db/connection');
const Order = require('../models/Order');

async function main() {
  await connectDB();
  console.log('[DB CONNECTED]');
  const order = await Order.findOne({
    $or: [
      { id: /186632/ },
      { orderNumber: /186632/ }
    ]
  });

  if (!order) {
    console.log('Order 186632 not found. Showing latest 3 orders:');
    const latest = await Order.find({}).sort({ createdAt: -1 }).limit(3);
    for (const o of latest) {
      console.log(`Order: ${o.id}, sku: ${o.sku}, images: ${(o.images || []).length}, product: ${o.product}`);
    }
    process.exit(0);
  }

  console.log('Found order:', order.id);
  console.log('orderNumber:', order.orderNumber);
  console.log('sku:', order.sku);
  console.log('product:', order.product);
  console.log('productType:', order.productType);
  console.log('images count:', (order.images || []).length);
  if (order.images && order.images.length > 0) {
    console.log('Sample image 0:', JSON.stringify(order.images[0], null, 2));
    console.log('All image captions:');
    order.images.forEach((img, i) => {
      console.log(`  [${i + 1}] caption: "${img.caption || ''}" | url: ${img.url || img.src || ''}`);
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
