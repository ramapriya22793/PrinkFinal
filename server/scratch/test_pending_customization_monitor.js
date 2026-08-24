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

async function testPendingCustomizationMonitor() {
  console.log('===============================================================');
  console.log('   VERIFYING PENDING CUSTOMIZATION & UPLOAD MONITOR (READY/PENDING)');
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

  const id1 = Math.floor(900000 + Math.random() * 90000);
  const id2 = Math.floor(900000 + Math.random() * 90000);

  // 1. Ingest Pending Order (No Customization Uploaded Yet)
  const pendingPayload = {
    id: id1,
    order_number: id1,
    name: `#${id1}`,
    email: `pending_${id1}@theprink.in`,
    total_price: '1899.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: id1, first_name: 'Pending', last_name: 'Customer', email: `pending_${id1}@theprink.in` },
    line_items: [{ id: id1 + 1, title: 'Personalized Cushion', quantity: 1, price: '1899.00', sku: 'CUSHION-01' }]
  };
  await makePost('/api/webhooks/shopify', pendingPayload);

  // 2. Ingest Ready Order (Customization Uploaded)
  const readyPayload = {
    id: id2,
    order_number: id2,
    name: `#${id2}`,
    email: `ready_${id2}@theprink.in`,
    total_price: '2199.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: id2, first_name: 'Ready', last_name: 'Customer', email: `ready_${id2}@theprink.in` },
    line_items: [{ id: id2 + 1, title: 'Personalized Frame', quantity: 1, price: '2199.00', sku: 'FRAME-02' }]
  };
  await makePost('/api/webhooks/shopify', readyPayload);

  // Submit customization for Order 2 so it becomes "Ready"
  const custToken = (await makePost('/api/auth/shopify-dev-login', { email: `ready_${id2}@theprink.in` })).data.token;
  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });

  const ordersRes = await makeGet('/api/orders/customer/orders', custToken);
  const ord2 = ordersRes.data.find(o => String(o.orderNumber) === String(id2));

  await makePost(`/api/orders/${encodeURIComponent(ord2.id)}/design`, {
    images: [{ id: 'img1', url: '/uploads/sample.jpg' }],
    customizationStatus: 'completed'
  }, { 'Authorization': `Bearer ${custToken}` });

  // 3. Fetch Admin Orders and Verify Categories
  const adminRes = await makeGet('/api/orders?limit=100', adminToken);
  const allOrders = adminRes.data.orders || [];

  const foundPending = allOrders.find(o => String(o.orderNumber) === String(id1));
  const foundReady = allOrders.find(o => String(o.orderNumber) === String(id2));

  assert(foundPending, `Pending Order #${id1} ingested and found in Admin Orders`);
  assert(foundReady, `Ready Order #${id2} ingested and found in Admin Orders`);

  // Verify custom tracker logic
  const isPendingCustomizationReceived = !!(foundPending.customizationStatus === 'completed' || (foundPending.images && foundPending.images.length > 0));
  const isReadyCustomizationReceived = !!(foundReady.customizationStatus === 'completed' || (foundReady.images && foundReady.images.length > 0));

  assert(!isPendingCustomizationReceived, `Order #${id1} correctly classified as Pending (Customization Needed)`);
  assert(isReadyCustomizationReceived, `Order #${id2} correctly classified as Ready (Customization Received)`);

  console.log('\n===============================================================');
  console.log(`   MONITOR & CUSTOMIZATION TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testPendingCustomizationMonitor();
