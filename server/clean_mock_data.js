
const mongoose = require('mongoose');
const { MONGODB_URI } = require('./db/connection');

async function cleanMockData() {
  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    
    console.log('Connected to database, cleaning mock data...');
    
    // Delete orders where shopifyId is null/missing, OR id starts with #
    const result = await db.collection('orders').deleteMany({
      $or: [
        { shopifyId: { $exists: false } },
        { shopifyId: null },
        { shopifyId: '' },
        { id: { $regex: '^#' } }
      ]
    });
    
    console.log("Deleted mock orders.");
    
    // Keep only real shopify orders
    const remaining = await db.collection('orders').countDocuments();
    console.log("Remaining real orders: " + remaining);
    
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

cleanMockData();

