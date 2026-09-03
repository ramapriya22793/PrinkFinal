const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI is not set. Configure server/.env before running this script.');
  process.exit(1);
}

async function seedActivityLogs() {
  const conn = await mongoose.createConnection(URI).asPromise();
  console.log('Connected to MongoDB for Activity Logs seeding.');
  const db = conn.db;

  const orders = await db.collection('orders').find({}).toArray();

  if (orders.length === 0) {
    console.error('Orders missing. Run seedOrders first.');
    await conn.close();
    return;
  }

  const activityLogs = [];

  for (const order of orders) {
    let currentTimestamp = new Date(order.orderDate);

    const addLog = (performedBy, role, description, minutesToAdd) => {
      currentTimestamp = new Date(currentTimestamp.getTime() + minutesToAdd * 60000);
      activityLogs.push({
        _id: new mongoose.Types.ObjectId(),
        activityId: `act_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        orderId: order._id,
        orderNumber: order.orderNumber,
        performedBy,
        role,
        description,
        timestamp: new Date(currentTimestamp)
      });
    };

    // Every order has been placed
    addLog(order.customerName, 'Customer', 'Order placed on Shopify', 0);
    
    // Customer uploaded image
    addLog(order.customerName, 'Customer', 'Customer Uploaded Image', 15);
    
    // Preview generated
    addLog('System', 'System', 'Preview Generated automatically', 16);

    // If order has progressed
    if (order.fulfillmentStatus !== 'UNFULFILLED') {
      addLog('Admin', 'Admin', 'Admin Approved the design', 120);
      addLog('System', 'System', 'Assigned To Printer', 125);
    }

    if (['PRINTING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.fulfillmentStatus)) {
      addLog('Printer Terminal 1', 'Printer', 'Printing Started', 1440); // Next day
      addLog('Printer Terminal 1', 'Printer', 'Printing Completed', 1480);
    }

    if (['PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.fulfillmentStatus)) {
      addLog('Admin', 'Admin', 'Packed', 1500);
    }

    if (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.fulfillmentStatus)) {
      addLog('Logistics', 'Carrier', 'Shipped via BlueDart', 2880);
    }
    
    if (order.fulfillmentStatus === 'DELIVERED') {
      addLog('Logistics', 'Carrier', 'Delivered to customer', 5760); // +4 days
    }
  }

  const activityCollection = db.collection('activitylogs');
  await activityCollection.deleteMany({});
  await activityCollection.insertMany(activityLogs);
  
  console.log(`Inserted ${activityLogs.length} activity logs into 'activitylogs' collection.`);

  await conn.close();
  return activityLogs;
}

if (require.main === module) {
  seedActivityLogs().catch(console.error);
}

module.exports = seedActivityLogs;


