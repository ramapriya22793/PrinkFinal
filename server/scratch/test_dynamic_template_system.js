const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

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

function makePost(path, body, token) {
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

async function testDynamicTemplateSystem() {
  console.log('===============================================================');
  console.log('   VERIFYING DYNAMIC PRINT TEMPLATE SPECIFICATION SYSTEM');
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

  // 1. Test Default Template Resolution for photobook / magazine
  const resolve1 = await makeGet('/api/templates/resolve?productType=photobook');
  assert(resolve1.status === 200 && resolve1.data.success, 'Default template resolution endpoint returned 200 OK');
  assert(resolve1.data.template !== undefined, 'Resolved geometry specifications for photobook template');

  // 2. Add New Dynamic Product Template (e.g. New Viyara Custom Template #1)
  const customTemplatePayload = {
    id: 'tmpl_viyara_custom_01',
    name: 'Viyara Custom Product Template #1',
    productType: 'viyara_custom',
    category: 'Specialty Frames',
    skuMapping: ['VIYARA001', 'VIYARA002'],
    printArea: {
      widthMm: 210,
      heightMm: 297,
      dpi: 300,
      bleedMm: 3,
      safeMarginMm: 5
    },
    layoutSlots: [
      { slotIndex: 0, xMm: 10, yMm: 10, widthMm: 190, heightMm: 130, label: 'Top Hero Photo' },
      { slotIndex: 1, xMm: 10, yMm: 150, widthMm: 90, heightMm: 130, label: 'Bottom Left Photo' },
      { slotIndex: 2, xMm: 110, yMm: 150, widthMm: 90, heightMm: 130, label: 'Bottom Right Photo' }
    ],
    isDefault: false
  };

  const createRes = await makePost('/api/templates', customTemplatePayload, adminToken);
  assert(createRes.status === 200 && createRes.data.success, 'Created new dynamic product template Viyara Custom #1 via Admin API');

  // 3. Resolve Template by SKU VIYARA001 to verify dynamic override
  const resolve2 = await makeGet('/api/templates/resolve?sku=VIYARA001', adminToken);
  assert(resolve2.status === 200 && resolve2.data.success, 'Resolved SKU VIYARA001 against dynamic template specification');
  assert(resolve2.data.source === 'admin-assignment', 'SKU VIYARA001 correctly resolved via admin-assignment');
  assert(resolve2.data.template.name === 'Viyara Custom Product Template #1', 'Matched exact dynamic template name');

  console.log('\n===============================================================');
  console.log(`   DYNAMIC TEMPLATE TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testDynamicTemplateSystem();
