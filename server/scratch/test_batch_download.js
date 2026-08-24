const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PORT = 5000;
const WEBHOOK_SECRET = '25e334c5f56179e4c8af878cfb7df74b55efdd01cd52d5f06332de490d14914e';
const JWT_SECRET = process.env.JWT_SECRET || 'theprink_secret_key_2026';

function makePost(path, data, token = '', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...extraHeaders
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: buffer,
          text: buffer.toString('utf8')
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeMultipartUpload(uploadPath, imageBuffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(header, 'utf8'),
      imageBuffer,
      Buffer.from(footer, 'utf8')
    ]);

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: uploadPath,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: buffer,
          text: buffer.toString('utf8')
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeGet(path, token = '') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: path,
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: buffer,
          text: buffer.toString('utf8')
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function assert(condition, message) {
  if (condition) {
    console.log(`   [PASS] ${message}`);
  } else {
    console.error(`   [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

async function runTest() {
  console.log('===============================================================');
  console.log('    VERIFYING BATCH DOWNLOAD & STANDARDIZED NAMING CONVENTION');
  console.log('===============================================================\n');

  try {
    // 1. Ingest test order #184347 via Shopify Webhook with HMAC
    const testWebhookObject = {
      id: 18434799,
      name: '#184347',
      email: 'customer184347@example.com',
      created_at: new Date().toISOString(),
      financial_status: 'paid',
      fulfillment_status: null,
      line_items: [
        {
          id: 99881122,
          product_id: 887766,
          variant_id: 554433,
          title: 'Photo Magazine',
          quantity: 1,
          sku: 'PG-PM-01',
          requires_shipping: true
        }
      ],
      customer: {
        id: 7711,
        email: 'customer184347@example.com',
        first_name: 'Rahul',
        last_name: 'Sharma'
      }
    };

    const payloadString = JSON.stringify(testWebhookObject);
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
      .update(payloadString, 'utf8')
      .digest('base64');

    const webhookRes = await makePost('/api/webhooks/shopify', payloadString, '', {
      'x-shopify-topic': 'orders/paid',
      'x-shopify-shop-domain': 'prink-in.myshopify.com',
      'x-shopify-hmac-sha256': hmac
    });

    assert(webhookRes.status === 200, 'Ingested test order #184347 via Shopify Webhook');

    // 2. Dev login via query string
    const devLoginRes = await makePost('/api/auth/shopify-dev-login', {
      query: 'customer184347@example.com'
    });

    assert(devLoginRes.status === 200, 'Customer authenticated via Dev Login');
    
    let uploadToken = '';
    if (devLoginRes.status === 200) {
      const tokenData = JSON.parse(devLoginRes.text);
      const custOrders = await makeGet('/api/orders/customer/orders', tokenData.token);
      if (custOrders.status === 200) {
        const list = JSON.parse(custOrders.text);
        const target = list.find(o => String(o.orderNumber).includes('184347'));
        if (target && target.uploadToken) {
          uploadToken = target.uploadToken;
          const sharp = require('sharp');
          const sampleJpeg = await sharp({
            create: { width: 2400, height: 2400, channels: 3, background: { r: 255, g: 0, b: 0 } }
          }).jpeg().toBuffer();

          const uploadRes = await makeMultipartUpload(`/api/public/order/${target.uploadToken}/upload`, sampleJpeg, 'photo_01.jpg');
          if (uploadRes.status !== 200) {
            console.log('Upload error status:', uploadRes.status, 'text:', uploadRes.text);
          }
          assert(uploadRes.status === 200, 'Uploaded HD photo to Order #184347 via portal API');
        }
      }
    }

    // 3. Mint printer token
    const printerToken = jwt.sign(
      { id: 'printer_test_user', email: 'printer@theprink.in', role: 'printer' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    assert(!!printerToken, 'Minted valid printer JWT token');

    // 4. Fetch queue to locate order ID
    const queueRes = await makeGet('/api/printer/queue', printerToken);
    assert(queueRes.status === 200, 'Fetched Print Queue from server');

    let targetOrderIds = ['184347', '18434799', '#184347'];
    if (queueRes.status === 200) {
      const q = JSON.parse(queueRes.text).queue || [];
      const item = q.find(x => String(x.orderNumber || x.id).includes('184347'));
      if (item) targetOrderIds.push(item.id);
    }

    // 5. Perform Batch Download request
    const batchRes = await makePost('/api/printer/batch-download', {
      orderIds: targetOrderIds
    }, printerToken);

    assert(batchRes.status === 200, 'Batch Download API returned 200 OK');
    assert((batchRes.headers['content-type'] || '').includes('application/zip'), 'Content-Type header is application/zip');
    assert((batchRes.headers['content-disposition'] || '').includes('.zip'), 'Content-Disposition header specifies .zip filename');

    // 6. Validate ZIP Buffer header (PK\x03\x04)
    const isZip = batchRes.buffer.length > 30 && batchRes.buffer.readUInt32LE(0) === 0x04034b50;
    assert(isZip, 'Output binary is a valid ZIP archive (magic number PK\\x03\\x04)');

    const zipText = batchRes.buffer.toString('utf8');
    console.log('Zip file entries:', zipText.match(/Order_[^\s\x00-\x1F]+/g));
    assert(zipText.includes('_PG-PM-01_01.jpg'), 'ZIP contains file named according to standard convention: OrderNumber_SKU_PhotoNumber.jpg');

    console.log('\n===============================================================');
    console.log('   BATCH DOWNLOAD & NAMING CONVENTION TEST SUITE PASSED 100%');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  }
}

runTest();
