const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '25e334c5f56179e4c8af878cfb7df74b55efdd01cd52d5f06332de490d14914e';
const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

function makePost(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64');

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      'x-shopify-hmac-sha256': hmac,
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': 'prink-in.myshopify.com',
      ...extraHeaders
    };

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function makeGet(path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'GET',
      headers
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function testAdminSyncAndSorting() {
  console.log('===============================================================');
  console.log('   VERIFYING SHOPIFY ORDER SYNC & DESCENDING RECENT ORDERS');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`   [PASS] ${message}`);
      passed++;
    } else {
      console.error(`   [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Verify shopifyService exports createShopifyClient
  const shopifyService = require('../services/shopify.service');
  assert(typeof shopifyService.createShopifyClient === 'function', 'shopifyService.createShopifyClient is defined and exported as a function');

  // 2. Ingest Orders with different timestamps & numbers (#8001 then #8002)
  const order1Payload = {
    id: 800100,
    order_number: 8001,
    name: '#8001',
    email: 'sorttest@theprink.in',
    total_price: '1499.00',
    financial_status: 'paid',
    created_at: new Date(Date.now() - 600000).toISOString(), // 10 mins ago
    customer: { id: 8001, first_name: 'First', last_name: 'Order', email: 'sorttest@theprink.in' },
    line_items: [{ id: 80011, title: 'Mug 8001', quantity: 1, price: '1499.00', sku: 'MUG-8001' }]
  };

  const order2Payload = {
    id: 800200,
    order_number: 8002,
    name: '#8002',
    email: 'sorttest@theprink.in',
    total_price: '1999.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(), // Now (Newer)
    customer: { id: 8002, first_name: 'Second', last_name: 'Order', email: 'sorttest@theprink.in' },
    line_items: [{ id: 80022, title: 'Frame 8002', quantity: 1, price: '1999.00', sku: 'FRAME-8002' }]
  };

  await makePost('/api/webhooks/shopify', order1Payload);
  await makePost('/api/webhooks/shopify', order2Payload);

  // 3. Admin Order Fetch & Sort Check
  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });
  const adminOrdersRes = await makeGet('/api/orders?limit=50', adminToken);
  assert(adminOrdersRes.status === 200, 'Admin orders endpoint returned 200 OK');

  const orders = adminOrdersRes.data.orders || [];
  assert(orders.length >= 2, `Retrieved ${orders.length} orders from Admin API`);

  // Verify descending sort: Newest Order -> Oldest Order
  let isSortedDescending = true;
  for (let i = 0; i < orders.length - 1; i++) {
    const tA = new Date(orders[i].createdAt || orders[i].updatedAt || 0).getTime();
    const tB = new Date(orders[i + 1].createdAt || orders[i + 1].updatedAt || 0).getTime();
    if (tA < tB) {
      isSortedDescending = false;
      break;
    }
  }

  assert(isSortedDescending, 'Recent Orders are strictly sorted: Newest Order → Oldest Order (Descending)');

  console.log('\n===============================================================');
  console.log(`   SYNC & SORTING TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testAdminSyncAndSorting();
