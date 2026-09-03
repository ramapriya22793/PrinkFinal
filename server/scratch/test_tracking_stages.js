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

async function testTrackingStages() {
  console.log('===============================================================');
  console.log('   VERIFYING UNIFIED 6-STAGE ORDER TRACKING FLOW');
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

  // Generate Admin JWT Token
  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });

  // Stage 1: Order Received
  console.log('Stage 1: Order Received...');
  const orderPayload = {
    id: 8877665544,
    order_number: 5099,
    name: '#5099',
    email: 'trackingtest@theprink.in',
    total_price: '1999.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: 887766, first_name: 'Ananya', last_name: 'Roy', email: 'trackingtest@theprink.in', phone: '+919876500000' },
    line_items: [{ id: 554433, title: 'Butterfly Frame Box', quantity: 1, price: '1999.00', sku: 'BUTTERFLY-01' }]
  };

  const res1 = await makePost('/api/webhooks/shopify', orderPayload);
  assert(res1.status === 200, 'Order Received Stage Ingestion');

  const loginRes = await makePost('/api/auth/shopify-dev-login', { email: 'trackingtest@theprink.in' });
  const customerToken = loginRes.data.token;

  let ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  let order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order && (order.workflowStatus === 'order_received' || order.workflowStatus === 'personalization_pending' || !order.workflowStatus), 'Stage 1: Order Received Verified in Customer Portal');

  // Stage 2: Personalization Pending -> Submitted
  console.log('\nStage 2: Personalization Pending -> Photo Uploaded...');
  const encodedId = encodeURIComponent(order.id);
  const photos = [{ id: 'p1', name: 'my_photo.jpg', url: '/uploads/originals/my_photo.jpg' }];
  const submitRes = await makePost(`/api/orders/${encodedId}/design`, { images: photos, customizationStatus: 'completed' }, { 'Authorization': `Bearer ${customerToken}` });
  assert(submitRes.status === 200, 'Customer Photo Submission Response 200 OK');

  ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order.customizationStatus === 'completed' || order.workflowStatus === 'photo_uploaded', 'Stage 2: Personalization Submitted Verified');

  // Stage 3: Printing
  console.log('\nStage 3: Printing...');
  const printRes = await makePost(`/api/printer/queue/${encodedId}/status`, { status: 'printing' }, { 'Authorization': `Bearer ${adminToken}` });
  assert(printRes.status === 200, 'Printer transition to "printing" HTTP 200 OK');

  ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order.workflowStatus === 'printing' || order.printStatus === 'processing', 'Stage 3: Printing Live Status Verified');

  // Stage 4: Ready for Dispatch
  console.log('\nStage 4: Ready for Dispatch...');
  const dispatchRes = await makePost(`/api/printer/queue/${encodedId}/status`, { status: 'ready_for_dispatch' }, { 'Authorization': `Bearer ${adminToken}` });
  assert(dispatchRes.status === 200, 'Printer transition to "ready_for_dispatch" HTTP 200 OK');

  ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order.workflowStatus === 'ready_for_dispatch' || order.orderStatus === 'Ready for Dispatch', 'Stage 4: Ready for Dispatch Live Status Verified');

  // Stage 5: In Transit
  console.log('\nStage 5: In Transit...');
  const transitRes = await makePost(`/api/printer/queue/${encodedId}/status`, { status: 'in_transit' }, { 'Authorization': `Bearer ${adminToken}` });
  assert(transitRes.status === 200, 'Transition to "in_transit" HTTP 200 OK');

  ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order.workflowStatus === 'in_transit' || order.deliveryStatus === 'shipped', 'Stage 5: In Transit Live Status Verified');

  // Stage 6: Delivered
  console.log('\nStage 6: Delivered...');
  const deliveredRes = await makePost(`/api/printer/queue/${encodedId}/status`, { status: 'delivered' }, { 'Authorization': `Bearer ${adminToken}` });
  assert(deliveredRes.status === 200, 'Transition to "delivered" HTTP 200 OK');

  ordersRes = await makeGet('/api/orders/customer/orders', customerToken);
  order = ordersRes.data.find(o => String(o.orderNumber) === '5099');
  assert(order.workflowStatus === 'delivered' || order.deliveryStatus === 'delivered', 'Stage 6: Delivered Live Status Verified');

  console.log('\n===============================================================');
  console.log(`   UNIFIED TRACKING STAGES PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testTrackingStages();
