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

async function testPrinterPortalUploadFlow() {
  console.log('===============================================================');
  console.log('   VERIFYING ORDER #184347 FULL FLOW TO PRINTER PORTAL');
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

  // 1. Ingest Order #184347 from Shopify Webhook
  const orderNum = '184347';
  const shopifyPayload = {
    id: 184347,
    order_number: 184347,
    name: '#184347',
    email: 'customer184347@theprink.in',
    total_price: '2799.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: 184347, first_name: 'Priya', last_name: 'Sharma', email: 'customer184347@theprink.in' },
    line_items: [{ id: 1843471, title: 'Personalized Photo Frame #184347', quantity: 1, price: '2799.00', sku: 'FRAME-184347' }]
  };

  const webhookRes = await makePost('/api/webhooks/shopify', shopifyPayload);
  assert(webhookRes.status === 200, 'Step 1: Ingested Order #184347 via Shopify Webhook');

  // 2. Customer Dev Login & Customer Uploads Photos
  const custLogin = await makePost('/api/auth/shopify-dev-login', { orderNumber: '184347', email: 'customer184347@theprink.in' });
  const custToken = custLogin.data.token;
  assert(custToken !== undefined, 'Step 2: Customer logged in via upload token authentication');

  const ordersRes = await makeGet('/api/orders/customer/orders', custToken);
  const ordersList = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data?.orders || []);
  const custOrder = ordersList.find(o => String(o.orderNumber) === '184347');
  assert(custOrder !== undefined, 'Customer retrieved Order #184347');

  // Submit photos for Order #184347
  const photos = [{ id: 'p184347', name: 'priya_frame_photo.jpg', url: '/uploads/originals/priya_frame_photo.jpg' }];
  const submitRes = await makePost(`/api/orders/${encodeURIComponent(custOrder.id)}/design`, {
    images: photos,
    customizationStatus: 'completed'
  }, { 'Authorization': `Bearer ${custToken}` });

  assert(submitRes.status === 200, 'Step 3: Customer successfully submitted photos for Order #184347');

  // 3. Admin Portal Verification
  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });
  const adminOrdersRes = await makeGet('/api/orders?limit=100', adminToken);
  const adminOrdersList = Array.isArray(adminOrdersRes.data) ? adminOrdersRes.data : (adminOrdersRes.data?.orders || adminOrdersRes.data?.data || []);
  const adminOrder = adminOrdersList.find(o => String(o.orderNumber) === '184347');
  assert(adminOrder && (adminOrder.customizationStatus === 'completed' || adminOrder.uploadStatus === 'ready'), 'Step 4: Order #184347 photos reflected in Admin Portal (Ready/Completed)');

  // 4. Printer Portal Verification (GET /api/printer/queue)
  const printerToken = jwt.sign({ id: 'printer1', email: 'printer@theprink.com', role: 'printer' }, jwtSecret, { expiresIn: '1h' });
  const printerQueueRes = await makeGet('/api/printer/queue', printerToken);
  assert(printerQueueRes.status === 200 && printerQueueRes.data.success, 'Step 5: Printer API returned 200 OK');

  const printQueue = printerQueueRes.data.queue || [];
  const printerJob = printQueue.find(job => String(job.orderNumber || job.id).replace(/\D/g, '') === '184347');

  assert(printerJob !== undefined, 'Step 6: Order #184347 print job automatically available in Printer Dashboard queue!');

  console.log('\n===============================================================');
  console.log(`   PRINTER PORTAL FLOW TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testPrinterPortalUploadFlow();
