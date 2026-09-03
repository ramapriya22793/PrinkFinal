/**
 * Covers the endpoints the admin and printer dashboards actually call, the
 * production state machine, and notification idempotency.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'test_secret_for_prink_suite';
process.env.SHOPIFY_WEBHOOK_SECRET = 'test_webhook_secret';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');

let mongod, app, Order, Notification;
const tmp = [];

const tokenFor = role => jwt.sign({ id: `u_${role}`, email: `${role}@theprink.test`, role }, process.env.JWT_SECRET);
const admin = () => `Bearer ${tokenFor('admin')}`;
const printer = () => `Bearer ${tokenFor('printer')}`;

async function photo(w = 3000, h = 3800) {
  const f = path.join(require('node:os').tmpdir(), `wf_${crypto.randomBytes(6).toString('hex')}.jpg`);
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 80 } } })
    .jpeg({ quality: 90 }).toFile(f);
  tmp.push(f);
  return f;
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('theprink_wf');
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../index.js');
  Order = require('../models/Order');
  Notification = require('../models/Notification');
  // Ensure the unique index backing notification dedupe is actually built.
  await Notification.init();
  await Order.init();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  for (const f of tmp) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
});

/** Seed an order and drive it through upload + confirm, returning its id. */
async function confirmedOrder(overrides = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = `WF-${crypto.randomBytes(4).toString('hex')}`;
  await Order.create({
    id,
    orderNumber: '2002',
    customer: { name: 'Flow Tester', email: 'flow@example.com', phone: '+919999999999' },
    product: 'Photo Frame 8x10',
    sku: 'PRK-FRM-810',
    quantity: 1,
    uploadToken: token,
    uploadTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    uploadLink: `http://localhost:3001/upload/${token}`,
    ...overrides
  });
  await request(app).post(`/api/public/order/${token}/upload`).attach('image', await photo()).expect(200);
  const res = await request(app).post(`/api/public/order/${token}/confirm`).expect(200);
  for (const f of res.body.printFiles) tmp.push(path.join(__dirname, '..', f.url.replace(/^\//, '')));
  return { id, token };
}

/* ------------------------- admin endpoints ------------------------- */

test('admin can approve, and approval yields a print file that exists on disk', async () => {
  const { id } = await confirmedOrder();
  const res = await request(app).post(`/api/orders/${id}/review`)
    .set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  assert.equal(res.body.order.adminApprovalStatus, 'approved');
  assert.ok(res.body.order.pdfUrl, 'approval must expose a real print file URL');
  assert.ok(fs.existsSync(path.join(__dirname, '..', res.body.order.pdfUrl.replace(/^\//, ''))));
});

test('routing to the printer requires approval first', async () => {
  const { id } = await confirmedOrder();
  const early = await request(app).post(`/api/orders/${id}/route-to-printer`)
    .set('Authorization', admin()).expect(409);
  assert.match(early.body.error, /Approve this design/);

  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);
  const ok = await request(app).post(`/api/orders/${id}/route-to-printer`).set('Authorization', admin()).expect(200);
  assert.equal(ok.body.order.printStatus, 'queued');
});

test('route-to-printer is admin only', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/route-to-printer`).expect(401);
  await request(app).post(`/api/orders/${id}/route-to-printer`).set('Authorization', printer()).expect(403);
});

test('regenerate rebuilds the print file from the original', async () => {
  const { id } = await confirmedOrder();
  const before = await Order.findOne({ id }).lean();

  const res = await request(app).post(`/api/orders/${id}/regenerate`).set('Authorization', admin()).expect(200);
  assert.equal(res.body.failures.length, 0);
  assert.equal(res.body.printFiles.length, 1);

  const after = await Order.findOne({ id }).lean();
  tmp.push(path.join(__dirname, '..', after.printFiles[0].url.replace(/^\//, '')));
  assert.notEqual(after.printFiles[0].url, before.printFiles[0].url, 'a fresh file should be produced');
  // The approved composition must be untouched by regeneration.
  assert.deepEqual(after.images[0].transform, before.images[0].transform);
});

test('admin editing creates a revision and never loses the approved artwork', async () => {
  const { id } = await confirmedOrder();
  const before = await Order.findOne({ id }).lean();
  const approvedTransform = before.images[0].transform;
  const imageId = before.images[0].id;

  // Admin nudges the composition.
  const edited = { ...approvedTransform, scale: 1.9, offsetX: 0.2 };
  const res = await request(app).post(`/api/orders/${id}/submit-design`)
    .set('Authorization', admin())
    .send({ designData: { layers: ['text'] }, images: [{ id: imageId, transform: edited }] })
    .expect(200);

  assert.equal(res.body.revision, 1);
  assert.equal(res.body.failures.length, 0);
  for (const f of res.body.printFiles) tmp.push(path.join(__dirname, '..', f.url.replace(/^\//, '')));

  const after = await Order.findOne({ id }).lean();
  assert.equal(after.images[0].transform.scale, 1.9, 'the admin edit must be applied');
  // The customer's approved composition is preserved, not overwritten.
  assert.deepEqual(after.customerApprovedImages[0].transform, approvedTransform);
  assert.equal(after.designRevisions.length, 1);

  // ...and the original source file is untouched by editing.
  assert.equal(after.images[0].originalKey, before.images[0].originalKey);

  // Restore returns exactly what the customer approved.
  await request(app).post(`/api/orders/${id}/restore-customer-design`).set('Authorization', admin()).expect(200);
  const restored = await Order.findOne({ id }).lean();
  assert.deepEqual(restored.images[0].transform, approvedTransform);
});

test('admin design endpoints are admin only', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/submit-design`).send({}).expect(401);
  await request(app).post(`/api/orders/${id}/submit-design`)
    .set('Authorization', printer()).send({}).expect(403);
  await request(app).post(`/api/orders/${id}/restore-customer-design`)
    .set('Authorization', printer()).expect(403);
});

test('the admin asset library rejects non-images and path traversal', async () => {
  const bad = path.join(require('node:os').tmpdir(), `asset_${Date.now()}.txt`);
  fs.writeFileSync(bad, 'not an image');
  tmp.push(bad);

  await request(app).post('/api/uploads').set('Authorization', admin())
    .attach('file', bad, { contentType: 'text/plain' }).expect(400);

  // A traversal id must 404, never delete outside the asset directory.
  await request(app).delete('/api/uploads/..%2F..%2F..%2Fetc%2Fpasswd')
    .set('Authorization', admin()).expect(404);

  await request(app).get('/api/uploads').expect(401);
});

/* ------------------------- printer endpoints ----------------------- */

test('printer download returns a real, existing file', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  const res = await request(app).get(`/api/printer/download/${id}`).set('Authorization', printer()).expect(200);
  assert.ok(res.body.url && res.body.filename);
  assert.equal(res.body.colourSpace, 'RGB', 'colour space must be reported honestly');
  assert.ok(fs.existsSync(path.join(__dirname, '..', res.body.url.replace(/^\//, ''))));
});

test('printer download is refused for unapproved and unauthenticated callers', async () => {
  const { id } = await confirmedOrder();
  await request(app).get(`/api/printer/download/${id}`).expect(401);
  await request(app).get(`/api/printer/download/${id}`).set('Authorization', printer()).expect(403); // not approved
});

test('the queue payload matches the printer dashboard contract', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  const res = await request(app).get('/api/printer/queue').set('Authorization', printer()).expect(200);
  const row = res.body.queue.find(r => r.id === id);
  assert.ok(row, 'the approved order must appear in the queue');

  // These are the exact fields PrinterPortal.tsx renders. A missing `status`
  // leaves the status column blank, and a `customer` object renders as
  // "[object Object]".
  assert.equal(typeof row.status, 'string');
  assert.ok(['pending', 'processing', 'print-ready', 'completed'].includes(row.status));
  assert.equal(typeof row.customer, 'string', 'customer must be a display string');
  assert.equal(typeof row.priority, 'string');
  assert.ok(row.trimSize);
  assert.ok(row.assignedAt);
});

test('the printer dashboard vocabulary is accepted by the backend', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  // 'processing' is what the existing printer UI emits.
  await request(app).post(`/api/printer/queue/${id}/status`)
    .set('Authorization', printer()).send({ status: 'processing' }).expect(200);

  const order = await Order.findOne({ id }).lean();
  assert.equal(order.printStatus, 'processing');
  assert.equal(order.orderStatus, 'Printing');
});

test('the production state machine refuses stage skipping', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  // queued -> completed skips processing/printed/packed and must be refused.
  const res = await request(app).post(`/api/printer/queue/${id}/status`)
    .set('Authorization', printer()).send({ status: 'completed' }).expect(409);
  assert.equal(res.body.code, 'INVALID_TRANSITION');

  // Walking the stages in order succeeds.
  for (const s of ['processing', 'printed', 'packed', 'delivered']) {
    await request(app).post(`/api/printer/queue/${id}/status`)
      .set('Authorization', printer()).send({ status: s }).expect(200);
  }
  const order = await Order.findOne({ id }).lean();
  assert.equal(order.printStatus, 'completed');
  assert.equal(order.deliveryStatus, 'delivered');
});

test('repeated identical status updates stay consistent', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/review`).set('Authorization', admin()).send({ action: 'approve' }).expect(200);

  await Promise.all([1, 2, 3].map(() => request(app).post(`/api/printer/queue/${id}/status`)
    .set('Authorization', printer()).send({ status: 'processing' })));

  const order = await Order.findOne({ id }).lean();
  assert.equal(order.printStatus, 'processing');
});

/* ------------------------- notifications --------------------------- */

test('notifications are idempotent - a double click sends once', async () => {
  const { id } = await confirmedOrder();

  const first = await request(app).post(`/api/orders/${id}/notify`).set('Authorization', admin()).expect(200);
  const second = await request(app).post(`/api/orders/${id}/notify`).set('Authorization', admin()).expect(200);

  assert.equal(first.body.queued, true);
  assert.equal(second.body.duplicate, true, 'the second send must be suppressed');

  const notes = await Notification.find({ orderId: id, type: 'upload_link' }).lean();
  assert.equal(notes.length, 1, 'exactly one notification record');
});

test('an unconfigured WhatsApp provider records rather than falsely claiming delivery', async () => {
  const { id } = await confirmedOrder();
  const res = await request(app).post(`/api/orders/${id}/notify`).set('Authorization', admin()).expect(200);

  assert.equal(res.body.delivered, false, 'must not claim delivery without a provider');
  assert.equal(res.body.channel, 'recorded');

  const note = await Notification.findOne({ orderId: id }).lean();
  assert.equal(note.status, 'recorded');
  assert.ok(note.message.includes('/upload/'), 'the upload link must be in the message');
});

test('notify is admin only', async () => {
  const { id } = await confirmedOrder();
  await request(app).post(`/api/orders/${id}/notify`).expect(401);
});

/* ------------------------- admin utility --------------------------- */

test('user administration hides password hashes and validates roles', async () => {
  const create = await request(app).post('/api/users').set('Authorization', admin())
    .send({ email: 'newop@theprink.test', password: 'secret123', name: 'Op', role: 'printer' })
    .expect(201);

  assert.equal(create.body.user.role, 'printer');
  assert.equal(create.body.user.passwordHash, undefined, 'password hash must never be returned');

  await request(app).post('/api/users').set('Authorization', admin())
    .send({ email: 'bad@theprink.test', password: 'x', role: 'superuser' })
    .expect(400);

  const list = await request(app).get('/api/users').set('Authorization', admin()).expect(200);
  assert.ok(!JSON.stringify(list.body).includes('passwordHash'));
});

test('user administration is admin only', async () => {
  await request(app).get('/api/users').expect(401);
  await request(app).get('/api/users').set('Authorization', printer()).expect(403);
});

test('SKU export returns data for the admin backup flow', async () => {
  const res = await request(app).get('/api/skus/export').set('Authorization', admin()).expect(200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(typeof res.body.count, 'number');
});

/* ------------------------- template resolution --------------------- */

test('template resolve serves the geometry all renderers share', async () => {
  const res = await request(app).get('/api/templates/resolve?sku=PRK-FRM-810').expect(200);
  assert.equal(res.body.template.id, 'tpl-frame-8x10');
  assert.equal(res.body.pixels.trimWidth, 2400);
  assert.equal(res.body.pixels.trimHeight, 3000);
});

test('an unknown SKU falls back rather than crashing', async () => {
  const res = await request(app).get('/api/templates/resolve?sku=NOT-A-REAL-SKU').expect(200);
  assert.ok(res.body.template.id, 'a fallback template must always be returned');
  assert.ok(res.body.template.printArea);
});
