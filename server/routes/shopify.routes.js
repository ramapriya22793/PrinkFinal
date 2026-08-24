const express = require('express');
const router = express.Router();
const shopifyController = require('../controllers/shopify.controller');
const { verifySessionToken } = require('../middleware/shopify.middleware');

// OAuth Authentication Routes
router.get('/auth', shopifyController.initiateOAuth);
router.get('/callback', shopifyController.handleOAuthCallback);

// Connectivity Test (secured with session verification)
router.get('/test-connection', verifySessionToken, shopifyController.testConnectivity);

// REST API Endpoints for Admin data
router.get('/shop', verifySessionToken, shopifyController.getShopDetailsHandler);

// Products CRUD API
router.get('/products', verifySessionToken, shopifyController.getProductsHandler);
router.get('/products/:id', verifySessionToken, shopifyController.getSingleProductHandler);
router.post('/products', verifySessionToken, shopifyController.createProductHandler);
router.put('/products/:id', verifySessionToken, shopifyController.updateProductHandler);
router.delete('/products/:id', verifySessionToken, shopifyController.deleteProductHandler);

// Orders CRUD API
router.get('/orders', verifySessionToken, shopifyController.getOrdersHandler);
router.get('/orders/:id', verifySessionToken, shopifyController.getSingleOrderHandler);

// Customers, Inventory, Collections
router.get('/customers', verifySessionToken, shopifyController.getCustomersHandler);
router.get('/inventory', verifySessionToken, shopifyController.getInventoryHandler);
router.get('/collections', verifySessionToken, shopifyController.getCollectionsHandler);
router.post('/sync', verifySessionToken, shopifyController.syncHandler);

module.exports = router;
