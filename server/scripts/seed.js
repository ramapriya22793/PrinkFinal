require('../utils/dns-fix');
require('dotenv').config({ path: '../.env' });
const seedCustomers = require('./seedCustomers');
const seedProducts = require('./seedProducts');
const seedOrders = require('./seedOrders');
const seedPersonalization = require('./seedPersonalization');
const seedActivityLogs = require('./seedActivityLogs');

async function runAllSeeds() {
  try {
    console.log('--- Starting MongoDB Seeding Process ---');
    
    await seedCustomers();
    await seedProducts();
    await seedOrders();
    await seedPersonalization();
    await seedActivityLogs();

    console.log('--- Seeding Completed Successfully! ---');
    console.log('Your prinkdb has been populated with 50 customers, 20 products, 150 orders, and all related personalization/activity logs.');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding process:', error);
    process.exit(1);
  }
}

runAllSeeds();


