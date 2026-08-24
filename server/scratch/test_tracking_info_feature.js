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

async function testTrackingInfoFeature() {
  console.log('===============================================================');
  console.log('   VERIFYING SHOPIFY TRACKING INFO & CUSTOMIZATION TRANSITION');
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

  const uniqueId = Math.floor(700000 + Math.random() * 200000);
  const uniqueEmail = `trackingtest_${uniqueId}@theprink.in`;

  // 1. Ingest Order without tracking info first
  const orderPayload1 = {
    id: uniqueId,
    order_number: uniqueId,
    name: `#${uniqueId}`,
    email: uniqueEmail,
    total_price: '2499.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: uniqueId, first_name: 'Rahul', last_name: 'Verma', email: uniqueEmail },
    line_items: [{ id: uniqueId + 1, title: 'Personalized Photo Frame', quantity: 1, price: '2499.00', sku: 'FRAME-01' }]
  };

  const res1 = await makePost('/api/webhooks/shopify', orderPayload1);
  assert(res1.status === 200, `Order #${uniqueId} Ingestion without tracking info`);

  const loginRes = await makePost('/api/auth/shopify-dev-login', { email: uniqueEmail });
  const token = loginRes.data.token;

  let ordersRes = await makeGet('/api/orders/customer/orders', token);
  let order1 = ordersRes.data.find(o => String(o.orderNumber) === String(uniqueId));
  assert(order1 && !order1.trackingUrl, `Order #${uniqueId} correctly lacks tracking URL initially`);

  // 2. Submit Customization for Order
  const encodedId = encodeURIComponent(order1.id);
  const photos = [{ id: 'p1', name: 'photo1.jpg', url: '/uploads/originals/photo1.jpg' }];
  const submitRes = await makePost(`/api/orders/${encodedId}/design`, { images: photos, customizationStatus: 'completed' }, { 'Authorization': `Bearer ${token}` });
  assert(submitRes.status === 200, `Customization submission for Order #${uniqueId} succeeded`);

  ordersRes = await makeGet('/api/orders/customer/orders', token);
  order1 = ordersRes.data.find(o => String(o.orderNumber) === String(uniqueId));
  assert(order1.customizationStatus === 'completed', `Order #${uniqueId} customization locked and moved to tracking experience`);

  // 3. Ingest Fulfillment Webhook with Tracking URL & AWB Number
  const orderPayload2 = {
    ...orderPayload1,
    fulfillments: [
      {
        tracking_number: 'BLUEDART123456789',
        tracking_url: 'https://www.bluedart.com/tracking?awb=BLUEDART123456789',
        tracking_company: 'BlueDart'
      }
    ]
  };
  const res2 = await makePost('/api/webhooks/shopify', orderPayload2);
  assert(res2.status === 200, 'Fulfillment webhook with tracking info ingested');

  ordersRes = await makeGet('/api/orders/customer/orders', token);
  order1 = ordersRes.data.find(o => String(o.orderNumber) === String(uniqueId));
  assert(order1.trackingNumber === 'BLUEDART123456789', `Order #${uniqueId} tracking number updated to BLUEDART123456789`);
  assert(order1.trackingUrl === 'https://www.bluedart.com/tracking?awb=BLUEDART123456789', `Order #${uniqueId} tracking URL updated to BlueDart link`);
  assert(order1.trackingCompany === 'BlueDart', `Order #${uniqueId} tracking company updated to BlueDart`);

  console.log('\n===============================================================');
  console.log(`   TRACKING FEATURE TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testTrackingInfoFeature();
