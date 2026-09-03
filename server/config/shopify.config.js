/**
 * Configuration file for Shopify integration.
 * Loads env variables and exposes them to the app.
 */
require('dotenv').config();

module.exports = {
  apiKey: process.env.SHOPIFY_API_KEY || '',
  apiSecret: process.env.SHOPIFY_API_SECRET || '',
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
  store: process.env.SHOPIFY_STORE, // e.g. store.myshopify.com
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
  appUrl: process.env.SHOPIFY_APP_URL, // Host domain where this app is hosted
  scopes: process.env.SHOPIFY_SCOPES ? process.env.SHOPIFY_SCOPES.split(',') : ['read_products', 'write_products', 'read_orders', 'write_orders', 'read_customers', 'write_customers', 'read_inventory', 'write_inventory'],
  webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
  jwtSecret: process.env.JWT_SECRET || 'theprink_secret_key_2026',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/theprink'
};
