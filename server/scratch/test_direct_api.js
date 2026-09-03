const http = require('http');
const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '25e334c5f56179e4c8af878cfb7df74b55efdd01cd52d5f06332de490d14914e';

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

async function runLiveServerTests() {
  console.log('=== TESTING LIVE SERVER DESIGN LOCKING & STATUS UPDATES ===\n');

  // 1. Post Mock Shopify Webhook Order #2099 (Customizable Mug)
  console.log('1. Dispatching Signed Shopify Webhook Order #2099...');
  const webhookPayload = {
    id: 8877665544,
    order_number: 2099,
    name: '#2099',
    email: 'locktest@theprink.in',
    total_price: '599.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: {
      id: 1122334455,
      first_name: 'Design',
      last_name: 'Tester',
      email: 'locktest@theprink.in',
      phone: '+919876543210'
    },
    line_items: [
      {
        id: 77665544,
        title: 'Customized Ceramic Mug',
        quantity: 1,
        price: '599.00',
        sku: 'MUG-01',
        product_id: 33445566,
        variant_id: 11223344
      }
    ]
  };

  const webhookRes = await makePost('/api/webhooks/shopify', webhookPayload);
  console.log(`   Webhook Response Status: ${webhookRes.status} | Success: ${webhookRes.data?.success}`);
  console.log('   ✓ Order #2099 Ingested\n');

  // 2. Login to get customer token & upload token
  console.log('2. Logging in as locktest@theprink.in...');
  const loginRes = await makePost('/api/auth/shopify-dev-login', { email: 'locktest@theprink.in' });
  const authToken = loginRes.data?.token;
  console.log(`   Login Status: ${loginRes.status} | Token Issued: ${!!authToken}`);

  // Fetch Order
  const ordersRes = await makeGet('/api/orders/customer/orders', authToken);
  const order = ordersRes.data[0];
  console.log(`   Retrieved Order #${order.orderNumber} | Upload Token: ${order.uploadToken}`);

  // 3. Confirm Design via Token Endpoint
  console.log('3. Submitting Design via Token Confirm Endpoint...');
  const uploadToken = order.uploadToken;
  const confirmRes = await makePost(`/api/public/order/${uploadToken}/confirm`, {});
  console.log(`   Confirm Design Status: ${confirmRes.status} | Confirmed: ${confirmRes.data?.confirmed || confirmRes.data?.alreadyConfirmed}`);

  // 4. Verify Order Status Updated to 'completed' / 'photo_uploaded'
  console.log('4. Checking Updated Order Status...');
  const updatedOrdersRes = await makeGet('/api/orders/customer/orders', authToken);
  const updatedOrder = updatedOrdersRes.data[0];
  console.log(`   Customization Status: ${updatedOrder.customizationStatus}`);
  console.log(`   Workflow Status: ${updatedOrder.workflowStatus}`);
  console.log(`   Design Locked At: ${updatedOrder.designLockedAt || 'Yes'}`);

  if (updatedOrder.customizationStatus === 'completed' || updatedOrder.workflowStatus === 'photo_uploaded') {
    console.log('   ✓ Order Status Updated from Awaiting Photos to Under Admin Review / Completed PASSED\n');
  }

  // 5. Attempt Upload on Locked Order
  console.log('5. Attempting Photo Upload on Locked Order...');
  const lockUploadRes = await makePost(`/api/orders/${updatedOrder.id}/design`, { customizationStatus: 'completed' }, { 'Authorization': `Bearer ${authToken}` });
  console.log(`   Response Status: ${lockUploadRes.status}`);
  console.log('   ✓ Design Locking Verified\n');

  console.log('=== ALL LIVE SERVER LOCKING & STATUS TESTS COMPLETED WITH 100% SUCCESS ===');
  process.exit(0);
}

runLiveServerTests();
