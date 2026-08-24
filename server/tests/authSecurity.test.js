/**
 * Regression tests for the authentication vulnerabilities found in the final
 * audit. Each test corresponds to a way an anonymous caller could previously
 * obtain a privileged token, which defeated every RBAC check in the system.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'test_secret_for_prink_suite';
delete process.env.ENABLE_DEMO_LOGIN;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let mongod, app, db, User;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('theprink_auth');
  await mongoose.connect(process.env.MONGODB_URI);
  app = require('../index.js');
  db = require('../db');
  User = require('../models/User');
  await User.init();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const uniqueEmail = p => `${p}_${crypto.randomBytes(5).toString('hex')}@theprink.test`;

/* ---------------- privilege escalation via /register --------------- */

test('self-registration cannot choose a privileged role', async () => {
  const email = uniqueEmail('esc');
  const res = await request(app).post('/api/auth/register')
    .send({ email, password: 'longenoughpassword', name: 'Mallory', role: 'admin' })
    .expect(200);

  assert.equal(res.body.user.role, 'customer', 'role must be forced to customer');

  // The token itself must not carry admin either.
  const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
  assert.equal(decoded.role, 'customer');

  // And it must be rejected by an admin-only endpoint.
  await request(app).get('/api/users').set('Authorization', `Bearer ${res.body.token}`).expect(403);
});

test('registration enforces a minimum password length', async () => {
  await request(app).post('/api/auth/register')
    .send({ email: uniqueEmail('short'), password: 'abc' })
    .expect(400);
});

/* ---------------- privilege escalation via /admin-login ------------ */

test('admin-login does not create an admin for an arbitrary email', async () => {
  // Seed a real admin first, which permanently closes the bootstrap path.
  const adminEmail = uniqueEmail('realadmin');
  await db.createUser({ email: adminEmail, password: 'correct-horse-battery', role: 'admin', name: 'Real Admin' });

  const res = await request(app).post('/api/auth/admin-login')
    .send({ email: uniqueEmail('attacker'), password: 'whatever-i-like' });

  assert.equal(res.status, 401, 'an unknown email must not receive an admin token');
  assert.equal(res.body.token, undefined);
  assert.equal(await User.countDocuments({ email: /attacker/ }), 0, 'no account may be created');
});

test('admin-login rejects a wrong password for a real admin', async () => {
  const email = uniqueEmail('admin2');
  await db.createUser({ email, password: 'the-right-password', role: 'admin' });

  await request(app).post('/api/auth/admin-login').send({ email, password: 'the-wrong-password' }).expect(401);
  const ok = await request(app).post('/api/auth/admin-login').send({ email, password: 'the-right-password' }).expect(200);
  assert.equal(jwt.verify(ok.body.token, process.env.JWT_SECRET).role, 'admin');
});

test('a customer cannot obtain an admin token through admin-login', async () => {
  const email = uniqueEmail('cust');
  await db.createUser({ email, password: 'customer-password', role: 'customer' });

  const res = await request(app).post('/api/auth/admin-login')
    .send({ email, password: 'customer-password' });

  assert.equal(res.status, 401, 'a valid customer password must not yield an admin token');
  assert.equal(res.body.token, undefined);
});

/* ---------------- privilege escalation via /printer-login ---------- */

test('printer-login does not auto-provision printer accounts', async () => {
  const res = await request(app).post('/api/auth/printer-login')
    .send({ email: uniqueEmail('ghostprinter'), password: 'anything' });

  assert.equal(res.status, 401);
  assert.equal(res.body.token, undefined);
});

test('a customer cannot obtain a printer token', async () => {
  const email = uniqueEmail('cust2');
  await db.createUser({ email, password: 'customer-password', role: 'customer' });
  await request(app).post('/api/auth/printer-login').send({ email, password: 'customer-password' }).expect(401);
});

test('an admin-provisioned printer can log in', async () => {
  const email = uniqueEmail('printer');
  await db.createUser({ email, password: 'printer-password', role: 'printer' });

  const res = await request(app).post('/api/auth/printer-login')
    .send({ email, password: 'printer-password' }).expect(200);
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).role, 'printer');

  await request(app).get('/api/printer/queue').set('Authorization', `Bearer ${res.body.token}`).expect(200);
});

/* ---------------- passwordless accounts ---------------------------- */

test('an account with no password hash can never be logged into', async () => {
  // OTP/WhatsApp flows can create accounts without a password. Previously
  // `passwordHash ? compare : true` accepted ANY password for those.
  const email = uniqueEmail('nopass');
  await User.create({ id: `usr_${Date.now()}`, email, role: 'customer', name: 'No Password' });

  await request(app).post('/api/auth/login').send({ email, password: 'literally-anything' }).expect(401);
  await request(app).post('/api/auth/login').send({ email, password: '' }).expect(400);
});

test('login rejects a disabled account', async () => {
  const email = uniqueEmail('disabled');
  await db.createUser({ email, password: 'good-password', role: 'customer', status: 'suspended' });
  await request(app).post('/api/auth/login').send({ email, password: 'good-password' }).expect(403);
});

/* ---------------- demo login gating -------------------------------- */

test('demo login is disabled unless explicitly enabled', async () => {
  await request(app).post('/api/auth/demo-login').send({ name: 'Demo' }).expect(404);
});

test('demo login, when enabled, can only mint a customer token', async () => {
  process.env.ENABLE_DEMO_LOGIN = 'true';
  try {
    const res = await request(app).post('/api/auth/demo-login')
      .send({ name: 'Demo Person', phone: '+910000000000', role: 'admin' })
      .expect(200);
    assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).role, 'customer');
  } finally {
    delete process.env.ENABLE_DEMO_LOGIN;
  }
});

/* ---------------- token integrity ---------------------------------- */

test('a token signed with the wrong secret is rejected', async () => {
  const forged = jwt.sign({ id: 'x', email: 'x@x.com', role: 'admin' }, 'not-the-real-secret');
  await request(app).get('/api/users').set('Authorization', `Bearer ${forged}`).expect(403);
});

test('an expired token is rejected', async () => {
  const expired = jwt.sign({ id: 'x', email: 'x@x.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
  await request(app).get('/api/users').set('Authorization', `Bearer ${expired}`).expect(403);
});
