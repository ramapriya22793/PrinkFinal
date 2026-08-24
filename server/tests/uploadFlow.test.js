/**
 * End-to-end test of the critical customer scenario, against a real MongoDB
 * (in-memory) and the real Express app - no mocked routes or fake responses.
 *
 *   webhook -> secure token -> open portal -> upload -> adjust -> confirm
 *   -> server-side print file -> admin approves -> printer queue -> printer
 *   updates status, and CANNOT touch the artwork.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'test_secret_for_prink_suite';
process.env.SHOPIFY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:0/placeholder';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');

let mongod;
let app;
let Order;

const tmpFiles = [];

async function makePhoto(width = 3000, height = 3600) {
  const file = path.join(require('node:os').tmpdir(), `prink_test_${crypto.randomBytes(6).toString('hex')}.jpg`);
  await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .jpeg({ quality: 92 })
    .toFile(file);
  tmpFiles.push(file);
  return file;
}

const tokenFor = role => jwt.sign({ id: `u_${role}`, email: `${role}@theprink.test`, role }, process.env.JWT_SECRET);

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('theprink_test');
  await mongoose.connect(process.env.MONGODB_URI);

  app = require('../index.js');
  Order = require('../models/Order');
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
});

/** Seed an order the way the webhook service does, returning its raw token. */
async function seedOrder(overrides = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = `TEST-${crypto.randomBytes(4).toString('hex')}`;
  await Order.create({
    id,
    shopifyId: String(Date.now()),
    orderNumber: '1001',
    customer: { name: 'Test Customer', email: 't@example.com', phone: '+910000000000' },
    product: 'Photo Frame 8x10',
    sku: 'PRK-FRM-810',
    quantity: 1,
    uploadToken: token,
    uploadTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    uploadTokenExpiresAt: new Date(Date.now() + 7 * 864e5),
    ...overrides
  });
  return { id, token };
}

/* ------------------------------------------------------------------ */

test('GET portal returns the SKU-resolved template and no admin data', async () => {
  const { token } = await seedOrder();
  const res = await request(app).get(`/api/public/order/${token}`).expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.order.template.id, 'tpl-frame-8x10', 'PRK-FRM-810 must resolve to the frame template');
  assert.ok(res.body.order.template.printArea, 'portal must receive print geometry');
  assert.equal(res.body.order.template.dpi, 300);

  // Nothing sensitive may cross the public boundary.
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('uploadToken'), 'token must not be echoed back');
  assert.ok(!/shpat_/.test(body), 'Shopify admin token must never appear');
  assert.equal(res.body.order.shopifyId, undefined);
});

test('an invalid token is rejected', async () => {
  await request(app).get(`/api/public/order/${'0'.repeat(64)}`).expect(404);
});

test('an expired token is rejected with a clear code', async () => {
  const { token } = await seedOrder({ uploadTokenExpiresAt: new Date(Date.now() - 1000) });
  const res = await request(app).get(`/api/public/order/${token}`).expect(410);
  assert.equal(res.body.code, 'TOKEN_EXPIRED');
});

test('full flow: upload -> adjust -> confirm -> real print file', async () => {
  const { id, token } = await seedOrder();
  const photo = await makePhoto();

  // 1. Upload the original.
  const up = await request(app)
    .post(`/api/public/order/${token}/upload`)
    .attach('image', photo)
    .expect(200);

  assert.equal(up.body.success, true);
  const imageId = up.body.image.id;
  assert.ok(imageId);
  assert.equal(up.body.image.transform.scale, 1, 'new uploads start at the identity transform');

  // The ORIGINAL must be stored, not just a preview derivative.
  const stored = await Order.findOne({ id }).lean();
  assert.ok(stored.images[0].originalKey, 'original must be retained');
  assert.ok(stored.images[0].previewUrl, 'a separate preview derivative must exist');
  assert.notEqual(stored.images[0].originalKey, stored.images[0].previewUrl);
  assert.equal(stored.images[0].width, 3000);

  // 2. Adjust - the exact transform the customer sees must persist.
  const transform = { scale: 1.35, rotation: 0, offsetX: 0.08, offsetY: -0.05, brightness: 110, contrast: 95 };
  await request(app)
    .patch(`/api/public/order/${token}/image/${imageId}`)
    .send({ transform })
    .expect(200);

  const afterPatch = await Order.findOne({ id }).lean();
  assert.deepEqual(afterPatch.images[0].transform, transform);

  // 3. Confirm.
  const confirm = await request(app).post(`/api/public/order/${token}/confirm`).expect(200);
  assert.equal(confirm.body.confirmed, true);
  assert.equal(confirm.body.failures.length, 0, JSON.stringify(confirm.body.failures));
  assert.equal(confirm.body.printFiles.length, 1);

  // 4. The print file must physically exist at the right size.
  const locked = await Order.findOne({ id }).lean();
  assert.ok(locked.designLockedAt, 'design must be locked');
  assert.equal(locked.templateId, 'tpl-frame-8x10');

  const pdfPath = path.join(__dirname, '..', locked.printFiles[0].url.replace(/^\//, ''));
  assert.ok(fs.existsSync(pdfPath), `expected print file at ${pdfPath}`);
  tmpFiles.push(pdfPath);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
  assert.equal(locked.printFiles[0].dpi, 300);
  assert.equal(locked.printFiles[0].colourSpace, 'RGB');

  // 5. The transform that drove the print file is the customer's, unchanged.
  assert.deepEqual(locked.images[0].transform, transform,
    'the print file must be built from the exact approved transform');
});

test('confirming twice does not produce a second print job', async () => {
  const { id, token } = await seedOrder();
  await request(app).post(`/api/public/order/${token}/upload`).attach('image', await makePhoto()).expect(200);

  const first = await request(app).post(`/api/public/order/${token}/confirm`).expect(200);
  const second = await request(app).post(`/api/public/order/${token}/confirm`).expect(200);

  assert.equal(first.body.confirmed, true);
  assert.equal(second.body.alreadyConfirmed, true);

  const order = await Order.findOne({ id }).lean();
  assert.equal(order.printFiles.length, 1, 'exactly one print file after a double confirm');
  tmpFiles.push(path.join(__dirname, '..', order.printFiles[0].url.replace(/^\//, '')));
});

test('a locked design rejects further uploads and edits', async () => {
  const { token } = await seedOrder();
  await request(app).post(`/api/public/order/${token}/upload`).attach('image', await makePhoto()).expect(200);
  const c = await request(app).post(`/api/public/order/${token}/confirm`).expect(200);
  tmpFiles.push(path.join(__dirname, '..', c.body.printFiles[0].url.replace(/^\//, '')));

  const res = await request(app)
    .post(`/api/public/order/${token}/upload`)
    .attach('image', await makePhoto())
    .expect(409);
  assert.equal(res.body.code, 'DESIGN_LOCKED');
});

test('a low-resolution photo is rejected with actionable guidance', async () => {
  const { token } = await seedOrder();
  const tiny = await makePhoto(400, 500);

  const res = await request(app)
    .post(`/api/public/order/${token}/upload`)
    .attach('image', tiny)
    .expect(400);

  assert.equal(res.body.code, 'LOW_RESOLUTION');
  assert.match(res.body.error, /1800px/, 'the message must state the required size');
});

test('a non-image file is rejected', async () => {
  const { token } = await seedOrder();
  const bad = path.join(require('node:os').tmpdir(), `bad_${Date.now()}.txt`);
  fs.writeFileSync(bad, 'this is definitely not a photograph');
  tmpFiles.push(bad);

  await request(app)
    .post(`/api/public/order/${token}/upload`)
    .attach('image', bad, { contentType: 'text/plain' })
    .expect(400);
});

test('rapid concurrent uploads all persist (no lost update)', async () => {
  // Mug template allows 2 images; fire both at once.
  const { id, token } = await seedOrder({ sku: 'PRK-MUG-CLASSIC', product: 'Classic Mug' });
  const [a, b] = await Promise.all([makePhoto(2000, 1500), makePhoto(2100, 1600)]);

  const results = await Promise.all([
    request(app).post(`/api/public/order/${token}/upload`).attach('image', a),
    request(app).post(`/api/public/order/${token}/upload`).attach('image', b)
  ]);

  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const order = await Order.findOne({ id }).lean();
  assert.equal(order.images.length, 2, 'both concurrent uploads must survive');
  assert.notEqual(order.images[0].id, order.images[1].id, 'ids must be unique');
});

test('uploading beyond the template maximum is refused', async () => {
  const { token } = await seedOrder(); // frame => maxImages 1
  await request(app).post(`/api/public/order/${token}/upload`).attach('image', await makePhoto()).expect(200);
  const res = await request(app).post(`/api/public/order/${token}/upload`).attach('image', await makePhoto()).expect(400);
  assert.match(res.body.error, /maximum of 1/);
});

/* ---------------------- authorisation --------------------------- */

test('admin approval requires an admin token', async () => {
  const { id } = await seedOrder();
  await request(app).post(`/api/orders/${id}/review`).send({ action: 'approve' }).expect(401);
  await request(app).post(`/api/orders/${id}/review`)
    .set('Authorization', `Bearer ${tokenFor('customer')}`)
    .send({ action: 'approve' })
    .expect(403);
});

test('printer queue requires a printer/admin token', async () => {
  await request(app).get('/api/printer/queue').expect(401);
  await request(app).get('/api/printer/queue')
    .set('Authorization', `Bearer ${tokenFor('customer')}`)
    .expect(403);
  await request(app).get('/api/printer/queue')
    .set('Authorization', `Bearer ${tokenFor('printer')}`)
    .expect(200);
});

test('a printer cannot modify artwork', async () => {
  const { id } = await seedOrder({ adminApprovalStatus: 'approved' });
  const res = await request(app)
    .post(`/api/printer/queue/${id}/design`)
    .set('Authorization', `Bearer ${tokenFor('printer')}`)
    .send({ images: [{ id: 'evil', url: '/hacked.jpg' }] })
    .expect(403);
  assert.match(res.body.error, /cannot modify customer artwork/);
});

test('a printer cannot set an arbitrary status or smuggle extra fields', async () => {
  const { id } = await seedOrder({ adminApprovalStatus: 'approved' });

  await request(app).post(`/api/printer/queue/${id}/status`)
    .set('Authorization', `Bearer ${tokenFor('printer')}`)
    .send({ status: 'not-a-real-status' })
    .expect(400);

  await request(app).post(`/api/printer/queue/${id}/status`)
    .set('Authorization', `Bearer ${tokenFor('printer')}`)
    .send({ status: 'printing', images: [{ id: 'evil' }], pdfUrl: '/hacked.pdf' })
    .expect(200);

  const order = await Order.findOne({ id }).lean();
  assert.equal(order.printStatus, 'processing');
  assert.notEqual(order.pdfUrl, '/hacked.pdf', 'extra body fields must be ignored');
  assert.ok(!(order.images || []).some(i => i.id === 'evil'), 'artwork must be untouched');
});

test('unapproved orders are not visible to the print floor', async () => {
  const { id } = await seedOrder(); // adminApprovalStatus defaults to 'pending'
  await request(app).get(`/api/printer/queue/${id}`)
    .set('Authorization', `Bearer ${tokenFor('printer')}`)
    .expect(403);
});

/* ---------------------- webhook security ------------------------- */

test('a webhook without a valid HMAC is rejected', async () => {
  const payload = JSON.stringify({ id: 999, order_number: 1, line_items: [] });

  await request(app).post('/api/webhooks/shopify')
    .set('Content-Type', 'application/json')
    .send(payload)
    .expect(401); // no signature at all

  await request(app).post('/api/webhooks/shopify')
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Hmac-Sha256', 'obviously-wrong')
    .send(payload)
    .expect(401); // bad signature
});

test('a correctly signed webhook is accepted and is idempotent', async () => {
  const body = {
    id: 777001,
    order_number: 5150,
    name: '#TEST-5150',
    email: 'wh@example.com',
    total_price: '999.00',
    customer: { id: 42, first_name: 'Web', last_name: 'Hook', email: 'wh@example.com' },
    line_items: [{ id: 1, product_id: 2, variant_id: 3, title: 'Classic Mug', quantity: 1, price: '999.00', sku: 'PRK-MUG-CLASSIC' }]
  };
  const raw = JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(raw).digest('base64');

  const send = () => request(app).post('/api/webhooks/shopify')
    .set('Content-Type', 'application/json')
    .set('X-Shopify-Hmac-Sha256', hmac)
    .set('X-Shopify-Webhook-Id', 'delivery-abc-123')
    .set('X-Shopify-Topic', 'orders/create')
    .send(raw);

  await send().expect(200);
  await send().expect(200); // Shopify retry

  const orders = await Order.find({ shopifyId: '777001' }).lean();
  assert.equal(orders.length, 1, 'a retried webhook must not create a second workflow');

  const order = orders[0];
  assert.ok(order.uploadTokenHash, 'token must be stored hashed');
  assert.ok(order.uploadTokenExpiresAt, 'links must carry an expiry');
  assert.ok(order.uploadLink.includes('/upload/'), 'link must target the portal route');
});
