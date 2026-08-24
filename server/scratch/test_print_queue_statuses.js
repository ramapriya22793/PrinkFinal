const http = require('http');
const crypto = require('crypto');
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

async function testPrintQueueStatuses() {
  console.log('===============================================================');
  console.log('   VERIFYING SIMPLIFIED PRINT QUEUE PRODUCTION WORKFLOW');
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

  const printerToken = jwt.sign({ id: 'printer1', email: 'printer@theprink.com', role: 'printer' }, jwtSecret, { expiresIn: '1h' });

  // 1. Fetch Print Queue
  const queueRes = await makeGet('/api/printer/queue', printerToken);
  if (queueRes.status !== 200) console.log('Printer queue res:', queueRes);
  assert(queueRes.status === 200 && queueRes.data.success, 'Printer API returned 200 OK');

  const jobs = queueRes.data.queue || [];
  assert(Array.isArray(jobs), `Retrieved ${jobs.length} jobs from Print Queue`);

  // Verify all job statuses belong strictly to the 4 simplified categories: pending | print-ready | printing | completed
  const allowedStatuses = new Set(['pending', 'print-ready', 'printing', 'completed']);
  const invalidStatuses = jobs.filter(j => !allowedStatuses.has(j.status));
  assert(invalidStatuses.length === 0, 'All Print Queue jobs strictly conform to: Pending | Print Ready | Printing | Completed');

  // 2. Test Transition: Move job to 'printing'
  if (jobs.length > 0) {
    const testJob = jobs[0];
    const updateRes1 = await makePatch(`/api/printer/jobs/${encodeURIComponent(testJob.id)}/status`, { status: 'printing' }, printerToken);
    assert(updateRes1.status === 200 && updateRes1.data.success, `Updated Job #${testJob.orderNumber || testJob.id} status to 'printing'`);

    // Verify consolidated status
    const queueRes2 = await makeGet('/api/printer/queue', printerToken);
    const updatedJob = (queueRes2.data.queue || []).find(j => String(j.id) === String(testJob.id));
    assert(updatedJob && updatedJob.status === 'printing', 'Printer Queue reflects consolidated status as "printing"');

    // 3. Test Transition: Move job to 'completed'
    const updateRes2 = await makePatch(`/api/printer/jobs/${encodeURIComponent(testJob.id)}/status`, { status: 'completed' }, printerToken);
    assert(updateRes2.status === 200 && updateRes2.data.success, `Updated Job #${testJob.orderNumber || testJob.id} status to 'completed'`);
  }

  console.log('\n===============================================================');
  console.log(`   PRINT QUEUE STATUS TESTS PASSED: ${passed} / ${passed + failed}`);
  console.log('===============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

testPrintQueueStatuses();
