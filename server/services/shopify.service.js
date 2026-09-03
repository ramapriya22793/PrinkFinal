const axios = require('axios');
const shopifyConfig = require('../config/shopify.config');
const { createShopifyClient } = require('../utils/apiClient');
const crypto = require('crypto');
const { updateSpreadsheet } = require('./googleSheetService');
const { sendUploadLinkMessage } = require('./whatsapp.service');

// Models
const ShopifyProduct = require('../models/ShopifyProduct');
const ShopifyOrder = require('../models/ShopifyOrder');
const ShopifyCustomer = require('../models/ShopifyCustomer');

/**
 * Exchange OAuth code for permanent access token.
 */
const exchangeAuthCodeForToken = async (shop, code) => {
  const url = `https://${shop}/admin/oauth/access_token`;
  const payload = {
    client_id: shopifyConfig.apiKey,
    client_secret: shopifyConfig.apiSecret,
    code
  };

  console.log(`[SHOPIFY OAuth] Exchanging auth code for access token on ${url}`);
  try {
    const res = await axios.post(url, payload);
    return res.data; // { access_token: "...", scope: "..." }
  } catch (error) {
    console.error('[SHOPIFY OAuth TOKEN EXCHANGE ERROR]', error.response?.data || error.message);
    throw error;
  }
};

/**
 * API Wrapper functions for Shopify Admin REST Endpoints.
 */

// Get Shop Details
const getShopDetails = async (shop, token) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/shop.json');
  return response.data.shop;
};

// Products REST API Wrappers
const getProductsFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/products.json', { params });
  return response.data.products;
};

const getProductByIdFromShopify = async (shop, token, id) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get(`/products/${id}.json`);
  return response.data.product;
};

const createProductOnShopify = async (shop, token, productPayload) => {
  const client = createShopifyClient(shop, token);
  const response = await client.post('/products.json', { product: productPayload });
  return response.data.product;
};

const updateProductOnShopify = async (shop, token, id, productPayload) => {
  const client = createShopifyClient(shop, token);
  const response = await client.put(`/products/${id}.json`, { product: productPayload });
  return response.data.product;
};

const deleteProductFromShopify = async (shop, token, id) => {
  const client = createShopifyClient(shop, token);
  await client.delete(`/products/${id}.json`);
  return { success: true };
};

// Orders REST API Wrappers
const getOrdersFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/orders.json', { params: { status: 'any', ...params } });
  return response.data.orders;
};

const getOrderByIdFromShopify = async (shop, token, id) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get(`/orders/${id}.json`);
  return response.data.order;
};

// Customers REST API Wrapper
const getCustomersFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/customers.json', { params });
  return response.data.customers;
};

const searchCustomersFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/customers/search.json', { params });
  return response.data.customers;
};

// Inventory REST API Wrapper (adjust locations/inventory levels)
const getInventoryFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/inventory_levels.json', { params });
  return response.data.inventory_levels;
};

// Collections REST API Wrapper
const getCollectionsFromShopify = async (shop, token, params = {}) => {
  const client = createShopifyClient(shop, token);
  const response = await client.get('/custom_collections.json', { params });
  return response.data.custom_collections;
};

/**
 * Synchronization layer: Save & Update Shopify payloads into MongoDB.
 */

const syncProductToDb = async (p) => {
  const mappedProduct = {
    shopifyProductId: String(p.id),
    title: p.title,
    bodyHtml: p.body_html,
    vendor: p.vendor,
    productType: p.product_type,
    handle: p.handle,
    status: p.status || 'active',
    variants: (p.variants || []).map(v => ({
      variantId: String(v.id),
      title: v.title,
      price: v.price,
      sku: v.sku,
      inventoryItemId: String(v.inventory_item_id),
      inventoryQuantity: v.inventory_quantity
    })),
    images: (p.images || []).map(img => img.src),
    rawJson: p
  };

  return await ShopifyProduct.findOneAndUpdate(
    { shopifyProductId: mappedProduct.shopifyProductId },
    { $set: mappedProduct },
    { new: true, upsert: true }
  );
};

const syncOrderToDb = async (o) => {
  let customerName = 'Shopify Customer';
  if (o.customer) {
    customerName = `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || customerName;
  }

  const uploadToken = crypto.randomBytes(32).toString('hex');
  const uploadLink = `${process.env.FRONTEND_URL || 'https://theprink.in'}/o/${uploadToken}`;

  const mappedOrder = {
    shopifyOrderId: String(o.id),
    orderNumber: o.order_number,
    name: o.name || `#${o.order_number}`,
    email: o.email,
    financialStatus: o.financial_status,
    fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
    totalPrice: o.total_price,
    currency: o.currency,
    createdAtShopify: o.created_at,
    uploadToken,
    uploadLink,
    lineItems: (o.line_items || []).map(item => ({
      lineItemId: String(item.id),
      title: item.title,
      quantity: item.quantity,
      price: item.price,
      sku: item.sku,
      productId: String(item.product_id),
      variantId: String(item.variant_id)
    })),
    customer: o.customer ? {
      shopifyCustomerId: String(o.customer.id),
      firstName: o.customer.first_name,
      lastName: o.customer.last_name,
      email: o.customer.email,
      phone: o.customer.phone
    } : undefined,
    shippingAddress: o.shipping_address ? {
      address1: o.shipping_address.address1,
      address2: o.shipping_address.address2,
      city: o.shipping_address.city,
      province: o.shipping_address.province,
      country: o.shipping_address.country,
      zip: o.shipping_address.zip
    } : undefined,
    rawJson: o
  };

  const mongoose = require('mongoose');
  const Order = mongoose.model('Order');

  const dateFormatted = new Date(o.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const lineItemsList = o.line_items || [];
  for (const item of lineItemsList) {
    const portalOrderId = `${o.name || '#' + o.order_number}-${item.id}`;
    
    let pType = 'canvas';
    const titleLower = item.title.toLowerCase();
    if (titleLower.includes('mug')) pType = 'mug';
    else if (titleLower.includes('frame')) pType = 'frame';
    else if (titleLower.includes('calendar')) pType = 'calendar';
    else if (titleLower.includes('book') || titleLower.includes('photobook')) pType = 'photobook';
    else if (titleLower.includes('magazine')) pType = 'magazine';
    else if (titleLower.includes('butterfly')) pType = 'butterfly';
    else if (titleLower.includes('tshirt') || titleLower.includes('t-shirt') || titleLower.includes('shirt')) pType = 'tshirt';
    else if (titleLower.includes('pillow') || titleLower.includes('cushion')) pType = 'pillow';
    else if (titleLower.includes('keychain') || titleLower.includes('key chain')) pType = 'keychain';
    else if (titleLower.includes('mobilecase') || titleLower.includes('mobile case') || titleLower.includes('phone case')) pType = 'mobilecase';

    // Fetch product image from synced ShopifyProduct if present
    let productImage = '';
    try {
      const dbProduct = await ShopifyProduct.findOne({ shopifyProductId: String(item.product_id) }).lean();
      if (dbProduct && dbProduct.images && dbProduct.images.length > 0) {
        productImage = dbProduct.images[0];
      }
    } catch (err) {
      console.warn('Failed to resolve productImage from ShopifyProduct:', err.message);
    }

    // ── Resolve customization requirements from SKU record ──────────────────
    // Photo count per product type (fallback when SKU is not found in DB)
    const photoCountByType = {
      butterfly: 8, magazine: 4, photobook: 24,
      calendar: 12, frame: 4, mug: 1, tshirt: 1,
      mobilecase: 1, pillow: 1, keychain: 2, canvas: 1
    };
    // Non-customizable product identifiers (no photo upload needed)
    const nonCustomizableKeywords = ['gift card', 'gift-card', 'voucher', 'shipping', 'donation'];
    const isNonCustomizable = nonCustomizableKeywords.some(k => titleLower.includes(k));

    let requiresCustomization = !isNonCustomizable;
    let requiredPhotoCount = isNonCustomizable ? 0 : (photoCountByType[pType] || 1);

    try {
      const SKU = require('../models/SKU');
      if (item.sku) {
        const skuDoc = await SKU.findOne({ sku: item.sku }).lean();
        if (skuDoc) {
          requiredPhotoCount = typeof skuDoc.supportedImageCount === 'number' ? skuDoc.supportedImageCount : requiredPhotoCount;
          requiresCustomization = requiredPhotoCount > 0;
        }
      }
    } catch (skuErr) {
      console.warn('Failed to resolve customization requirements from SKU:', skuErr.message);
    }

    const orderDoc = {
      id: portalOrderId,
      shopifyId: String(o.id),
      orderNumber: o.order_number ? String(o.order_number) : '',
      customer: {
        id: o.customer?.id || '',
        name: customerName,
        email: o.email || o.customer?.email || '',
        phone: o.customer?.phone || o.shipping_address?.phone || ''
      },
      product: item.title,
      productType: pType,
      productImage: productImage,
      requiresCustomization,
      requiredPhotoCount,
      sku: item.sku || '',
      quantity: item.quantity,
      date: dateFormatted,
      shippingAddress: o.shipping_address,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()
    };

    await Order.findOneAndUpdate(
      { id: portalOrderId },
      { $set: orderDoc },
      { upsert: true }
    );
  }

  const updateQuery = {
    $set: { ...mappedOrder },
    $setOnInsert: { uploadToken, uploadLink, spreadsheetStatus: 'pending', whatsappStatus: 'pending', uploadStatus: 'pending' }
  };
  delete updateQuery.$set.uploadToken;
  delete updateQuery.$set.uploadLink;

  const savedOrder = await ShopifyOrder.findOneAndUpdate(
    { shopifyOrderId: mappedOrder.shopifyOrderId },
    updateQuery,
    { new: true, upsert: true }
  );

  // Trigger automation asynchronously if the order was newly inserted or pending sync
  if (savedOrder.spreadsheetStatus === 'pending') {
    updateSpreadsheet(savedOrder).then(success => {
      if (success) ShopifyOrder.updateOne({ _id: savedOrder._id }, { spreadsheetStatus: 'synced' }).exec();
    });
  }
  
  if (savedOrder.whatsappStatus === 'pending' && savedOrder.uploadLink) {
    sendUploadLinkMessage(savedOrder).then(success => {
      if (success) ShopifyOrder.updateOne({ _id: savedOrder._id }, { whatsappStatus: 'sent' }).exec();
    });
  }

  return savedOrder;
};

const syncCustomerToDb = async (c) => {
  const mappedCustomer = {
    shopifyCustomerId: String(c.id),
    email: c.email,
    firstName: c.first_name,
    lastName: c.last_name,
    phone: c.phone,
    ordersCount: c.orders_count,
    totalSpent: c.total_spent,
    state: c.state,
    verifiedEmail: c.verified_email,
    rawJson: c
  };

  return await ShopifyCustomer.findOneAndUpdate(
    { shopifyCustomerId: mappedCustomer.shopifyCustomerId },
    { $set: mappedCustomer },
    { new: true, upsert: true }
  );
};

/**
 * Scheduled sync triggers: Sync full datasets from Shopify to DB.
 */
const runFullProductSync = async (shop, token) => {
  console.log(`[SYNC RUNNER] Starting full product sync for ${shop}...`);
  let count = 0;
  let nextPageUrl = '/products.json?limit=250';
  const client = createShopifyClient(shop, token);

  while (nextPageUrl) {
    try {
      const response = await client.get(nextPageUrl);
      const batch = response.data.products || [];
      count += batch.length;
      for (const p of batch) {
        await syncProductToDb(p);
      }
      
      const linkHeader = response.headers['link'] || response.headers['Link'];
      nextPageUrl = null;
      if (linkHeader) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          nextPageUrl = match[1];
        }
      }
    } catch (err) {
      console.error('[SYNC RUNNER ERROR] Product page sync failed:', err.message);
      break;
    }
  }
  console.log(`[SYNC RUNNER] Sync finished. Mapped ${count} products to database.`);
  return { count };
};

const runFullOrderSync = async (shop, token) => {
  console.log(`[SYNC RUNNER] Starting full order sync for ${shop}...`);
  let count = 0;
  let nextPageUrl = '/orders.json?limit=250&status=any';
  const client = createShopifyClient(shop, token);

  while (nextPageUrl) {
    let attempts = 0;
    let success = false;

    while (attempts < 5 && !success) {
      try {
        attempts++;
        const response = await client.get(nextPageUrl);
        const batch = response.data.orders || [];
        count += batch.length;
        for (const o of batch) {
          await syncOrderToDb(o);
        }

        const linkHeader = response.headers['link'] || response.headers['Link'];
        nextPageUrl = null;
        if (linkHeader) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (match) {
            nextPageUrl = match[1];
          }
        }
        success = true;
        // Small delay between page requests to stay well within Shopify REST API rate limits
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn(`[SYNC RUNNER RATE LIMIT] 429 Too Many Requests on attempt ${attempts}. Backing off 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.error(`[SYNC RUNNER ERROR] Order page sync failed on attempt ${attempts}:`, err.message);
          if (attempts >= 3) {
            nextPageUrl = null;
            break;
          }
        }
      }
    }
  }
  console.log(`[SYNC RUNNER] Sync finished. Mapped ${count} orders to database.`);
  return { count };
};

const runFullCustomerSync = async (shop, token) => {
  console.log(`[SYNC RUNNER] Starting full customer sync for ${shop}...`);
  let count = 0;
  let nextPageUrl = '/customers.json?limit=250';
  const client = createShopifyClient(shop, token);

  while (nextPageUrl) {
    try {
      const response = await client.get(nextPageUrl);
      const batch = response.data.customers || [];
      count += batch.length;
      for (const c of batch) {
        await syncCustomerToDb(c);
      }
      
      const linkHeader = response.headers['link'] || response.headers['Link'];
      nextPageUrl = null;
      if (linkHeader) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          nextPageUrl = match[1];
        }
      }
    } catch (err) {
      console.error('[SYNC RUNNER ERROR] Customer page sync failed:', err.message);
      break;
    }
  }
  console.log(`[SYNC RUNNER] Sync finished. Mapped ${count} customers to database.`);
  return { count };
};

const authenticateCustomerWithShopify = async (shop, storefrontToken, email, password) => {
  const url = `https://${shop}/api/2024-01/graphql.json`;
  const query = `
    mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken {
          accessToken
          expiresAt
        }
        customerUserErrors {
          code
          field
          message
        }
      }
    }
  `;
  const variables = {
    input: {
      email,
      password
    }
  };

  const response = await axios.post(url, { query, variables }, {
    headers: {
      'X-Shopify-Storefront-Access-Token': storefrontToken,
      'Content-Type': 'application/json'
    }
  });

  const accessData = response.data?.data?.customerAccessTokenCreate;
  if (accessData?.customerUserErrors && accessData.customerUserErrors.length > 0) {
    throw new Error(accessData.customerUserErrors[0].message);
  }

  const accessToken = accessData?.customerAccessToken?.accessToken;
  if (!accessToken) {
    throw new Error('Invalid email or password.');
  }

  const profileQuery = `
    query {
      customer(customerAccessToken: "${accessToken}") {
        id
        firstName
        lastName
        email
        phone
      }
    }
  `;
  const profileResponse = await axios.post(url, { query: profileQuery }, {
    headers: {
      'X-Shopify-Storefront-Access-Token': storefrontToken,
      'Content-Type': 'application/json'
    }
  });

  const customer = profileResponse.data?.data?.customer;
  if (!customer) {
    throw new Error('Failed to retrieve customer profile details.');
  }

  return customer;
};

const registerCustomerOnShopify = async (shop, storefrontToken, payload) => {
  const url = `https://${shop}/api/2024-01/graphql.json`;
  const query = `
    mutation customerCreate($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        customer {
          id
          firstName
          lastName
          email
          phone
        }
        customerUserErrors {
          code
          field
          message
        }
      }
    }
  `;
  
  const nameParts = (payload.name || '').trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || 'Customer';

  const variables = {
    input: {
      email: payload.email,
      password: payload.password,
      firstName,
      lastName
    }
  };

  if (payload.phone) {
    variables.input.phone = payload.phone;
  }

  const response = await axios.post(url, { query, variables }, {
    headers: {
      'X-Shopify-Storefront-Access-Token': storefrontToken,
      'Content-Type': 'application/json'
    }
  });

  const createData = response.data?.data?.customerCreate;
  if (createData?.customerUserErrors && createData.customerUserErrors.length > 0) {
    throw new Error(createData.customerUserErrors[0].message);
  }

  return createData?.customer;
};

module.exports = {
  createShopifyClient,
  exchangeAuthCodeForToken,
  getShopDetails,
  getProductsFromShopify,
  getProductByIdFromShopify,
  createProductOnShopify,
  updateProductOnShopify,
  deleteProductFromShopify,
  getOrdersFromShopify,
  getOrderByIdFromShopify,
  getCustomersFromShopify,
  searchCustomersFromShopify,
  getInventoryFromShopify,
  getCollectionsFromShopify,
  authenticateCustomerWithShopify,
  registerCustomerOnShopify,
  
  // Sync
  syncProductToDb,
  syncOrderToDb,
  syncCustomerToDb,
  runFullProductSync,
  runFullOrderSync,
  runFullCustomerSync
};
