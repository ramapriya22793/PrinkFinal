require('dotenv').config();
const mongoose = require('mongoose');
const { getOrderByIdFromShopify, syncOrderToDb, getOrdersFromShopify } = require('../services/shopify.service');

// Add a script to fetch a specific order by Order Number or Shopify ID
// Usage: node syncSpecificOrder.js --orderNumber=1234
// or node syncSpecificOrder.js --shopifyId=567890

async function syncSpecificOrder() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const args = process.argv.slice(2);
    let orderNumber = null;
    let shopifyId = null;

    args.forEach(arg => {
      if (arg.startsWith('--orderNumber=')) {
        orderNumber = arg.split('=')[1];
      }
      if (arg.startsWith('--shopifyId=')) {
        shopifyId = arg.split('=')[1];
      }
    });

    if (!orderNumber && !shopifyId) {
      console.log('Please provide an order identifier: node syncSpecificOrder.js --orderNumber=XXXX or --shopifyId=XXXX');
      process.exit(1);
    }

    const shop = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    let orderData = null;

    if (shopifyId) {
      console.log(`Fetching Shopify Order ID: ${shopifyId}...`);
      orderData = await getOrderByIdFromShopify(shop, token, shopifyId);
    } else if (orderNumber) {
      console.log(`Searching for Order Number: ${orderNumber}...`);
      const orders = await getOrdersFromShopify(shop, token, { name: `#${orderNumber}` });
      if (orders && orders.length > 0) {
        orderData = orders[0];
      }
    }

    if (!orderData) {
      console.log('Order not found in Shopify.');
      process.exit(1);
    }

    console.log(`Found Order #${orderData.order_number}. Syncing to local DB...`);
    const savedOrder = await syncOrderToDb(orderData);

    console.log('Successfully synced order!');
    console.log(`Local Upload Link for this order: ${savedOrder.uploadLink}`);
    console.log(`Upload Token: ${savedOrder.uploadToken}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error syncing order:', error.message);
    if(error.response) console.error(JSON.stringify(error.response.data));
    process.exit(1);
  }
}

syncSpecificOrder();
