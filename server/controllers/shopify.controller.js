const crypto = require('crypto');
const shopifyConfig = require('../config/shopify.config');
const shopifyService = require('../services/shopify.service');
const { createShopifyClient } = require('../utils/apiClient');
const db = require('../db');

// Map to store random state tokens to prevent CSRF attacks in OAuth
const oauthStates = new Set();

/**
 * Step 1: Generate Shopify App OAuth Authorization URL.
 */
const initiateOAuth = (req, res) => {
  const shop = req.query.shop || shopifyConfig.store;
  if (!shop) {
    return res.status(400).json({ error: 'Shop domain parameter is required' });
  }

  // Normalize shop URL
  const normalizedShop = shop.endsWith('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  
  // CSRF Protection State Token
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.add(state);

  const redirectUri = `${shopifyConfig.appUrl}/api/shopify/callback`;
  const scopesString = shopifyConfig.scopes.join(',');

  const authUrl = `https://${normalizedShop}/admin/oauth/authorize?client_id=${shopifyConfig.apiKey}&scope=${scopesString}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  console.log(`[SHOPIFY OAuth] Redirecting user to authorization URL: ${authUrl}`);
  res.redirect(authUrl);
};

/**
 * Step 2: Handle Shopify App OAuth Callback.
 */
const handleOAuthCallback = async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  // Validate State (CSRF prevention)
  if (!oauthStates.has(state)) {
    return res.status(403).json({ error: 'OAuth State validation failed. Potential CSRF attack.' });
  }
  oauthStates.delete(state);

  if (!shop || !code || !hmac) {
    return res.status(400).json({ error: 'Required OAuth parameters missing' });
  }

  // Validate Shopify HMAC signature
  const queryMap = { ...req.query };
  delete queryMap.hmac;
  const sortedQuery = Object.keys(queryMap)
    .sort()
    .map(key => `${key}=${queryMap[key]}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', shopifyConfig.apiSecret)
    .update(sortedQuery)
    .digest('hex');

  if (generatedHmac !== hmac) {
    console.warn('[SHOPIFY OAuth CALLBACK] HMAC signature verification failed');
    return res.status(403).json({ error: 'HMAC signature verification failed' });
  }

  try {
    // Exchange temporary code for permanent token
    const tokenData = await shopifyService.exchangeAuthCodeForToken(shop, code);
    const permanentAccessToken = tokenData.access_token;
    
    console.log(`[SHOPIFY OAuth] Token successfully generated for store: ${shop}`);
    
    // In production, save the permanent access token securely in MongoDB.
    // For now, response with confirmation.
    res.json({
      success: true,
      message: `Shopify App Installed successfully on ${shop}!`,
      shop,
      accessToken: permanentAccessToken,
      scopes: tokenData.scope
    });
  } catch (err) {
    console.error('[SHOPIFY OAuth CALLBACK ERROR]', err.message);
    res.status(500).json({ error: 'OAuth callback flow failed.', details: err.message });
  }
};

/**
 * Test Connection endpoint.
 */
const testConnectivity = async (req, res) => {
  const shop = req.query.shop || shopifyConfig.store;
  const token = req.query.token || shopifyConfig.accessToken;

  try {
    const shopInfo = await shopifyService.getShopDetails(shop, token);
    res.json({
      success: true,
      message: 'Connected to Shopify Admin API successfully!',
      shop: shopInfo
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || 'Connection failed.'
    });
  }
};

/**
 * Controller handlers for Shop Details, Products, Orders, Customers, Inventory, Collections.
 */

const getShopDetailsHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const details = await shopifyService.getShopDetails(shop, token);
    res.json(details);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getProductsHandler = async (req, res) => {
  const shop = req.query.shop || shopifyConfig.store;
  const token = req.query.token || shopifyConfig.accessToken;
  console.log(`[SHOPIFY CONTROLLER] Fetching products for shop: ${shop}`);
  console.log(`[SHOPIFY CONTROLLER] Query parameters:`, token);
  try {
    const products = await shopifyService.getProductsFromShopify(shop, token, req.query);
    res.json(products);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getSingleProductHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const product = await shopifyService.getProductByIdFromShopify(shop, token, req.params.id);
    res.json(product);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const createProductHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const product = await shopifyService.createProductOnShopify(shop, token, req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const updateProductHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const product = await shopifyService.updateProductOnShopify(shop, token, req.params.id, req.body);
    res.json(product);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const deleteProductHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const result = await shopifyService.deleteProductFromShopify(shop, token, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getOrdersHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const orders = await shopifyService.getOrdersFromShopify(shop, token, req.query);
    res.json(orders);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getSingleOrderHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const order = await shopifyService.getOrderByIdFromShopify(shop, token, req.params.id);
    res.json(order);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getCustomersHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const customers = await shopifyService.getCustomersFromShopify(shop, token, req.query);
    res.json(customers);
  } catch (err) {
    console.error('[SHOPIFY GET CUSTOMERS ERROR]', err.message, err.response?.data);
    res.status(500).json({ success: false, error: 'Failed to fetch customers from Shopify: ' + err.message });
  }
};



const getInventoryHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const inventory = await shopifyService.getInventoryFromShopify(shop, token, req.query);
    res.json(inventory);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const getCollectionsHandler = async (req, res) => {
  try {
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const collections = await shopifyService.getCollectionsFromShopify(shop, token, req.query);
    res.json(collections);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const syncHandler = async (req, res) => {
  try {
    const shopifyConfig = require('../config/shopify.config');
    const shop = req.query.shop || shopifyConfig.store;
    const token = req.query.token || shopifyConfig.accessToken;
    const shopifyService = require('../services/shopify.service');

    if (!token || token === 'your_access_token_here' || token.includes('your_admin_access_token_here')) {
      return res.status(400).json({ success: false, error: 'Shopify API Token not configured.' });
    }

    console.log('[API MANUAL SYNC] Starting fast recent orders and products sync...');
    
    // Sync only the 50 most recent orders
    const client = createShopifyClient(shop, token);
    const response = await client.get('/orders.json', { params: { limit: 50, status: 'any' } });
    const orders = response.data.orders || [];
    
    for (const o of orders) {
      await shopifyService.syncOrderToDb(o);
    }
    
    // Sync only the 50 most recent products
    const prodResponse = await client.get('/products.json', { params: { limit: 50 } });
    const products = prodResponse.data.products || [];
    for (const p of products) {
      await shopifyService.syncProductToDb(p);
    }

    // Sync only the 50 most recent customers
    const custResponse = await client.get('/customers.json', { params: { limit: 50 } });
    const customers = custResponse.data.customers || [];
    for (const c of customers) {
      await shopifyService.syncCustomerToDb(c);
    }

    console.log(`[API MANUAL SYNC] Completed. Synced ${orders.length} orders, ${products.length} products, and ${customers.length} customers.`);
    res.json({ success: true, message: 'Sync completed successfully' });
  } catch (err) {
    console.error('[API MANUAL SYNC ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  initiateOAuth,
  handleOAuthCallback,
  testConnectivity,
  getShopDetailsHandler,
  getProductsHandler,
  getSingleProductHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler,
  getOrdersHandler,
  getSingleOrderHandler,
  getCustomersHandler,
  getInventoryHandler,
  getCollectionsHandler,
  syncHandler
};
