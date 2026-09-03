/**
 * Regression tests for the unauthenticated data-exposure and IDOR issues found
 * in the final audit. Each of these endpoints previously served or mutated
 * customer data with no credentials at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'test_secret_for_prink_suite';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let mongod, app, Order, Setting;

const tokenFor = role => `Bearer ${jwt.sign({ id: `u_${role}`, email: `${role}@t.test`, role }, process.env.JWT_SECRET)}`;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('theprink_expose');
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../index.js');
  Order = require('../models/Order');
  Setting = require('../models/Setting');
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

async function seed() {
  const token = crypto.randomBytes(32).toString('hex');
  const id = `EXP-${crypto.randomBytes(4).toString('hex')}`;
  await Order.create({
    id,
    shopifyId: '55501',
    orderNumber: '3003',
    customer: { name: 'Private Person', email: 'private@example.com', phone: '+919888877777' },
    product: 'Photo Frame 8x10',
    sku: 'PRK-FRM-810',
    uploadToken: token,
    uploadTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    shippingAddress: { address1: '10 Secret Lane', city: 'Trichy' },
    images: [{ id: 'img1', originalKey: 'originals/x.jpg', transform: { scale: 1 } }]
  });
  return { id, token };
}

test('the order list is not readable without an admin token', async () => {
  await seed();
  await request(app).get('/api/orders').expect(401);
  await request(app).get('/api/orders').set('Authorization', tokenFor('customer')).expect(403);
  await request(app).get('/api/orders').set('Authorization', tokenFor('printer')).expect(403);
  await request(app).get('/api/orders').set('Authorization', tokenFor('admin')).expect(200);
});

test('a single order cannot be read by guessing its id', async () => {
  const { id } = await seed();
  const res = await request(app).get(`/api/orders/${id}`);
  assert.equal(res.status, 401);
  // The PII must not be in the body of the rejection either.
  assert.ok(!JSON.stringify(res.body).includes('private@example.com'));
  assert.ok(!JSON.stringify(res.body).includes('9888877777'));
});

test('order artwork and status cannot be altered anonymously', async () => {
  const { id } = await seed();

  await request(app).post(`/api/orders/${id}/design`)
    .send({ images: [{ id: 'evil', url: '/hacked.jpg' }] })
    .expect(401);

  await request(app).patch(`/api/orders/${id}/status`)
    .send({ status: 'Delivered' })
    .expect(401);

  const order = await Order.findOne({ id }).lean();
  assert.equal(order.images.length, 1, 'artwork must be untouched');
  assert.equal(order.images[0].id, 'img1');
  assert.notEqual(order.orderStatus, 'Delivered');
});

test('orders cannot be created or deleted anonymously', async () => {
  const { id } = await seed();
  await request(app).post('/api/orders').send({ id: 'INJECTED' }).expect(401);
  await request(app).delete(`/api/orders/${id}`).expect(401);
  assert.equal(await Order.countDocuments({ id: 'INJECTED' }), 0);
});

test('the legacy token lookup does not echo the token or Shopify data', async () => {
  const { token } = await seed();
  const res = await request(app).get(`/api/orders/upload-token/${token}`).expect(200);

  const body = JSON.stringify(res.body);
  assert.ok(!body.includes(token), 'the token must not be echoed back');
  assert.equal(res.body.order.shopifyId, undefined);
  assert.equal(res.body.order.uploadToken, undefined);
  assert.equal(res.body.order.shippingAddress, undefined);
  assert.equal(res.body.order.product, 'Photo Frame 8x10', 'useful fields still returned');
});

test('settings never expose the Shopify admin token', async () => {
  await Setting.deleteMany({});
  await Setting.create({ shopifyStore: 'x.myshopify.com', shopifyAccessToken: 'shpat_supersecret_value' });

  // Unauthenticated access is refused outright.
  await request(app).get('/api/settings').expect(401);
  await request(app).get('/api/settings').set('Authorization', tokenFor('customer')).expect(403);

  // Even an admin only learns that a credential is configured.
  const res = await request(app).get('/api/settings').set('Authorization', tokenFor('admin')).expect(200);
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('shpat_supersecret_value'), 'the Shopify token must never be returned');
  assert.equal(res.body.settings.shopifyAccessTokenConfigured, true);
});

test('saving settings with a blank secret does not wipe the stored credential', async () => {
  await Setting.deleteMany({});
  await Setting.create({ shopifyStore: 'x.myshopify.com', shopifyAccessToken: 'shpat_keepme' });

  await request(app).put('/api/settings')
    .set('Authorization', tokenFor('admin'))
    .send({ shopifyStore: 'y.myshopify.com', shopifyAccessToken: '' })
    .expect(200);

  const stored = await Setting.findOne({}).lean();
  assert.equal(stored.shopifyAccessToken, 'shpat_keepme', 'a blank field means unchanged');
  assert.equal(stored.shopifyStore, 'y.myshopify.com');
});

test('a 500 does not leak internal details to the caller', async () => {
  // Force a failure by disconnecting the database mid-request.
  await mongoose.disconnect();
  const res = await request(app).get('/api/orders').set('Authorization', tokenFor('admin'));
  await mongoose.connect(process.env.MONGODB_URI);

  if (res.status >= 500) {
    const body = JSON.stringify(res.body);
    assert.ok(!/mongodb:\/\//i.test(body), 'no connection string in the response');
    assert.ok(!/\.js:\d+/.test(body), 'no stack frames in the response');
  }
});

test('health reports database state rather than always claiming ok', async () => {
  const res = await request(app).get('/api/health');
  assert.ok([200, 503].includes(res.status));
  assert.ok(['connected', 'unavailable'].includes(res.body.database));
});
