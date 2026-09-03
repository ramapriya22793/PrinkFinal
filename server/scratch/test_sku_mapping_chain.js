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

async function testSkuMappingChain() {
  console.log('===============================================================');
  console.log('   VERIFYING SHOPIFY SKU -> TEMPLATE -> RULES -> PRINT TEMPLATE CHAIN');
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

  const adminToken = jwt.sign({ id: 'admin1', email: 'admin@theprink.com', role: 'admin' }, jwtSecret, { expiresIn: '1h' });

  // 1. Configure SKU Mapping Rule in Admin Portal (SKU ABC123)
  const skuRulePayload = {
    id: 'sku_abc123',
    sku: 'ABC123',
    name: 'Photo Magazine 24-Page',
    productType: 'photobook',
    requiresCustomization: true,
    requiredPhotoCount: 24,
    supportedImageCount: 24,
    customizationRules: 'Photo Magazine 24-Page Layout',
    printTemplate: 'Magazine Print Template',
    printingInstructions: 'High-res offset print, 250 GSM glossy cover',
    status: 'active'
  };

  const saveSkuRes = await makePost('/api/skus', skuRulePayload, { 'Authorization': `Bearer ${adminToken}` });
  assert(saveSkuRes.status === 200 && saveSkuRes.data.success, 'Admin Portal API successfully configured SKU ABC123 rule mapping');

  // 2. Ingest Shopify Order with SKU ABC123
  const orderNum = Math.floor(880000 + Math.random() * 90000);
  const shopifyOrderPayload = {
    id: orderNum,
    order_number: orderNum,
    name: `#${orderNum}`,
    email: `skutest_${orderNum}@theprink.in`,
    total_price: '3499.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: { id: orderNum, first_name: 'Magazine', last_name: 'Buyer', email: `skutest_${orderNum}@theprink.in` },
    line_items: [{ id: orderNum + 1, title: 'Personalized Photo Magazine', quantity: 1, price: '3499.00', sku: 'ABC123' }]
  };

  const webhookRes = await makePost('/api/webhooks/shopify', shopifyOrderPayload);
  assert(webhookRes.status === 200, `Shopify Order #${orderNum} with SKU ABC123 ingested`);

  // 3. Fetch Ingested Order from Admin API and verify resolved chain properties
  const adminOrdersRes = await makeGet('/api/orders?limit=100', adminToken);
  const order = (adminOrdersRes.data.orders || []).find(o => String(o.orderNumber) === String(orderNum));

  assert(order !== undefined, `Order #${orderNum} retrieved from database`);
  assert(order.sku === 'ABC123', 'Shopify SKU correctly matched to ABC123');
  assert(order.requiresCustomization === true, 'System automatically resolved requiresCustomization = true');
  assert(order.requiredPhotoCount === 24, 'System automatically resolved requiredPhotoCount = 24 Photos');
  assert(order.productType === 'photobook', 'System automatically resolved Product Type = photobook / Photo Magazine');
  assert(order.customizationRules === 'Photo Magazine 24-Page Layout', 'System automatically resolved Customization Rules = Photo Magazine 24-Page Layout');
  assert(order.printTemplate === 'Magazine Print Template', 'System automatically resolved Print Template = Magazine Print Template');

  console.log('\n===============================================================');
  console.log(`   SKU MAPPING CHAIN TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testSkuMappingChain();
