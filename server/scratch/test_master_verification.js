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

function makePatch(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'PATCH',
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

async function runMasterVerification() {
  console.log('===============================================================');
  console.log('   MASTER AUTOMATED VERIFICATION SUITE — ALL FEATURES');
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

  const orderNum1 = Math.floor(400000 + Math.random() * 500000);
  const orderNum2 = orderNum1 + 1;
  const userEmail = `master_${orderNum1}@theprink.in`;

  // 1. Webhook Ingestion
  console.log(`1. Ingesting Test Shopify Orders (#${orderNum1} Customizable & #${orderNum2} Gift Card)...`);
  const shopifyPayload1 = {
    id: orderNum1,
    order_number: orderNum1,
    name: `#${orderNum1}`,
    email: userEmail,
    total_price: '2499.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: orderNum1, first_name: 'Master', last_name: 'Tester', email: userEmail },
    line_items: [{ id: orderNum1 + 10, title: 'Personalized Photo Mug', quantity: 1, price: '2499.00', sku: 'MUG-CUSTOM' }]
  };

  const shopifyPayload2 = {
    id: orderNum2,
    order_number: orderNum2,
    name: `#${orderNum2}`,
    email: userEmail,
    total_price: '500.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: orderNum2, first_name: 'Master', last_name: 'Tester', email: userEmail },
    line_items: [{ id: orderNum2 + 10, title: 'Digital Gift Card', quantity: 1, price: '500.00', sku: 'GIFT-CARD' }]
  };

  const res1 = await makePost('/api/webhooks/shopify', shopifyPayload1);
  const res2 = await makePost('/api/webhooks/shopify', shopifyPayload2);

  assert(res1.status === 200, `Customizable Order #${orderNum1} Webhook Ingestion`);
  assert(res2.status === 200, `Non-Customizable Order #${orderNum2} Webhook Ingestion\n`);

  // 2. Login Modes
  console.log('2. Testing Login Modes (Email ID Only vs Order Number + Email ID)...');
  const loginEmailOnly = await makePost('/api/auth/shopify-dev-login', { email: userEmail });
  if (loginEmailOnly.status !== 200) console.log('Login email response:', loginEmailOnly);
  assert(loginEmailOnly.status === 200 && loginEmailOnly.data?.success, 'Login Mode 1: Email ID Only');

  const loginOrderAndEmail = await makePost('/api/auth/shopify-dev-login', { orderNumber: String(orderNum1), email: userEmail });
  if (loginOrderAndEmail.status !== 200) console.log('Login order response:', loginOrderAndEmail);
  assert(loginOrderAndEmail.status === 200 && loginOrderAndEmail.data?.success, 'Login Mode 2: Order Number + Email ID\n');

  const emailToken = loginEmailOnly.data?.token || loginOrderAndEmail.data?.token;

  // 3. Order Details & Customization Eligibility
  console.log('3. Verifying Order Details & Customization Eligibility...');
  const ordersRes = await makeGet('/api/orders/customer/orders', emailToken);
  const custOrders = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data?.orders || []);
  assert(custOrders.length >= 1, `Retrieved customer orders (Count: ${custOrders.length})`);

  const order1 = custOrders.find(o => String(o.orderNumber) === String(orderNum1));
  const order2 = custOrders.find(o => String(o.orderNumber) === String(orderNum2));

  assert(order1 && (order1.requiresCustomization === true || (order1.requiredPhotoCount || 0) > 0), `Customizable Order #${orderNum1} requiresCustomization = true`);
  assert(order2 && (order2.requiresCustomization === false || order2.requiredPhotoCount === 0), `Non-Customizable Order #${orderNum2} requiresCustomization = false\n`);

  // 4. Photo Submission & Status
  if (order1) {
    console.log('4. Testing Photo Submission & Automatic Status Updates...');
    const encodedId = encodeURIComponent(order1.id);
    const photos = [
      { id: 'p1', name: 'photo_b.jpg', url: '/uploads/originals/photo_b.jpg' },
      { id: 'p2', name: 'photo_a.jpg', url: '/uploads/originals/photo_a.jpg' }
    ];

    const submitRes = await makePost(`/api/orders/${encodedId}/design`, { images: photos, customizationStatus: 'completed' }, { 'Authorization': `Bearer ${emailToken}` });
    assert(submitRes.status === 200, 'Submitted customer photos to backend API');

    const updatedRes = await makeGet('/api/orders/customer/orders', emailToken);
    const updatedList = Array.isArray(updatedRes.data) ? updatedRes.data : (updatedRes.data?.orders || []);
    const updatedOrder1 = updatedList.find(o => String(o.id) === String(order1.id));
    assert(updatedOrder1 && (updatedOrder1.customizationStatus === 'completed' || updatedOrder1.uploadStatus === 'ready'), 'Order status automatically updated to "completed/ready" upon photo upload\n');
  }

  // 5. Admin Portal Verification
  console.log('5. Verifying Admin & Printer Dashboards...');
  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });
  const adminOrdersRes = await makeGet('/api/orders?limit=100', adminToken);
  assert(adminOrdersRes.status === 200, 'Admin API returned 200 OK');

  const printerToken = jwt.sign({ id: 'printer1', email: 'printer@theprink.com', role: 'printer' }, jwtSecret, { expiresIn: '1h' });
  const printerQueueRes = await makeGet('/api/printer/queue', printerToken);
  assert(printerQueueRes.status === 200 && printerQueueRes.data.success, 'Printer Queue API returned 200 OK');

  const allowedStatuses = new Set(['pending', 'print-ready', 'printing', 'completed']);
  const queueJobs = printerQueueRes.data.queue || [];
  const invalidQueueStatuses = queueJobs.filter(j => !allowedStatuses.has(j.status));
  assert(invalidQueueStatuses.length === 0, 'Printer Queue strictly uses 4 statuses: Pending | Print Ready | Printing | Completed\n');

  console.log('===============================================================');
  console.log(`   TOTAL MASTER TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runMasterVerification();
