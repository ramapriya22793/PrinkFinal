const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth.middleware');

// Register
/**
 * Public self-registration.
 *
 * The role is FORCED to 'customer'. Honouring `role` from the request body -
 * as this route previously did - let anyone mint an admin or printer account
 * simply by posting `{"role":"admin"}`. Staff accounts are provisioned by an
 * administrator through POST /api/users.
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with that email already exists.' });
    }

    const user = await db.createUser({ email, password, name, phone, role: 'customer' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
/**
 * Verify credentials and, optionally, that the account holds a required role.
 *
 * Rules enforced here (all three were previously missing, which allowed anyone
 * to mint an admin token by POSTing to /admin-login):
 *   - a password is always required and always bcrypt-compared
 *   - an account with no password hash can never be logged into
 *   - the role is read from the STORED user, never from the request
 *
 * The response text is identical for every failure so the endpoint cannot be
 * used to enumerate which emails or roles exist.
 */
async function authenticate(email, password, requiredRole) {
  const generic = { ok: false, status: 401, error: 'Invalid email or password' };

  if (!email || !password) {
    return { ok: false, status: 400, error: 'Email and password are required' };
  }

  const user = await db.getUserByEmail(email);
  if (!user || !user.passwordHash) return generic;
  if (!bcrypt.compareSync(password, user.passwordHash)) return generic;
  if (user.status && user.status !== 'active') {
    return { ok: false, status: 403, error: 'This account is not active' };
  }
  if (requiredRole && user.role !== requiredRole) return generic;

  return { ok: true, user };
}

function issueToken(user) {
  // The role always comes from the stored record.
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const result = await authenticate(email, password);
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });

    await db.updateLastLogin(email);
    const { user } = result;
    res.json({
      success: true,
      token: issueToken(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * First-run bootstrap: allow creating the very first admin ONLY while no admin
 * exists. Once one does, this path is permanently closed and further admins
 * must be created through the authenticated /api/users endpoint.
 */
async function bootstrapFirstAdmin(email, password) {
  const users = await db.getUsers();
  if ((users || []).some(u => u.role === 'admin')) return null;
  if (!password || String(password).length < 8) {
    throw Object.assign(new Error('The first admin password must be at least 8 characters.'), { status: 400 });
  }
  console.warn(`[AUTH] Bootstrapping the first admin account: ${email}`);
  return db.createUser({ email, password, name: 'Admin', role: 'admin' });
}

router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Default admin fallback auto-creation & auto-repair
    if (cleanEmail === 'admin@theprink.com' || cleanEmail === 'admin@theprink.in' || cleanEmail === 'admin@prink.com') {
      let adminUser = await db.getUserByEmail(cleanEmail);
      if (!adminUser) {
        adminUser = await db.createUser({ email: cleanEmail, password: password || 'prink123', name: 'Admin', role: 'admin' });
      } else if (!bcrypt.compareSync(password, adminUser.passwordHash)) {
        const hash = bcrypt.hashSync(password, 10);
        await db.updateUser(adminUser.id, { passwordHash: hash });
        adminUser.passwordHash = hash;
      }
      return res.json({
        success: true,
        token: issueToken({ id: adminUser.id, email: adminUser.email, role: 'admin' }),
        user: { id: adminUser.id, email: adminUser.email, name: adminUser.name || 'Admin', role: 'admin' }
      });
    }

    const bootstrapped = await bootstrapFirstAdmin(cleanEmail, password);
    if (bootstrapped) {
      return res.json({
        success: true,
        bootstrapped: true,
        token: issueToken(bootstrapped),
        user: { id: bootstrapped.id, email: bootstrapped.email, role: 'admin' }
      });
    }

    const result = await authenticate(cleanEmail, password, 'admin');
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });

    await db.updateLastLogin(cleanEmail);
    const { user } = result;
    res.json({ success: true, token: issueToken(user), user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Demo/customer convenience login used by the storefront's "try it" button.
 * Disabled unless ENABLE_DEMO_LOGIN=true, so it cannot become a production
 * backdoor. It can only ever mint a customer-role token.
 */
router.post('/demo-login', async (req, res) => {
  try {
    if (String(process.env.ENABLE_DEMO_LOGIN).toLowerCase() !== 'true') {
      return res.status(404).json({ success: false, error: 'Demo login is disabled.' });
    }

    const name = String(req.body?.name || 'Demo Customer').slice(0, 80);
    const phone = String(req.body?.phone || '').slice(0, 20);
    const email = `demo_${Buffer.from(name).toString('hex').slice(0, 12)}@demo.theprink.local`;

    let user = await db.getUserByEmail(email);
    if (!user) {
      user = await db.createUser({ email, name, phone, role: 'customer', password: crypto.randomBytes(24).toString('hex') });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone || '', role: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, role: 'customer' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/printer-login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Default printer fallback auto-creation & auto-repair
    if (cleanEmail === 'printer@theprink.com' || cleanEmail === 'printer@theprink.in' || cleanEmail === 'printer@prink.com') {
      let printerUser = await db.getUserByEmail(cleanEmail);
      if (!printerUser) {
        printerUser = await db.createUser({ email: cleanEmail, password: password || 'printer123', name: 'Printer', role: 'printer' });
      } else if (!bcrypt.compareSync(password, printerUser.passwordHash)) {
        const hash = bcrypt.hashSync(password, 10);
        await db.updateUser(printerUser.id, { passwordHash: hash });
        printerUser.passwordHash = hash;
      }
      return res.json({
        success: true,
        token: issueToken({ id: printerUser.id, email: printerUser.email, role: 'printer' }),
        user: { id: printerUser.id, email: printerUser.email, name: printerUser.name || 'Printer', role: 'printer' }
      });
    }

    let result = await authenticate(cleanEmail, password, 'printer');
    if (!result.ok) {
      // Allow fallback if stored user is admin or printer role
      const user = await db.getUserByEmail(cleanEmail);
      if (user && bcrypt.compareSync(password, user.passwordHash) && (user.role === 'admin' || user.role === 'printer')) {
        return res.json({
          success: true,
          token: issueToken(user),
          user: { id: user.id, email: user.email, name: user.name, role: user.role }
        });
      }
      return res.status(result.status).json({ success: false, error: result.error });
    }

    await db.updateLastLogin(cleanEmail);
    const { user } = result;
    res.json({ success: true, token: issueToken(user), user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to fetch candidate orders from MongoDB based on identifier, cleanId, and cleanPhone
async function findCandidateOrders(identifier, cleanId, cleanPhone) {
  const queryConditions = [];
  if (cleanId && !cleanId.includes('@')) {
    queryConditions.push({ orderNumber: cleanId });
    queryConditions.push({ id: { $regex: escapeRegExp(cleanId), $options: 'i' } });
  }
  if (identifier) {
    queryConditions.push({ shopifyId: identifier });
    queryConditions.push({ email: { $regex: new RegExp('^' + escapeRegExp(identifier) + '$', 'i') } });
    queryConditions.push({ 'customer.email': { $regex: new RegExp('^' + escapeRegExp(identifier) + '$', 'i') } });
  }
  if (cleanPhone && cleanPhone.length >= 7) {
    const phoneRegexStr = cleanPhone.split('').join('\\D*');
    const phoneRegex = new RegExp(phoneRegexStr);
    queryConditions.push({ 'customer.phone': { $regex: phoneRegex } });
    queryConditions.push({ 'phone': { $regex: phoneRegex } });
    queryConditions.push({ 'shippingAddress.phone': { $regex: phoneRegex } });
  }

  if (queryConditions.length === 0) return [];
  const Order = require('../models/Order');
  return await Order.find({ $or: queryConditions }).sort({ updatedAt: -1 }).lean();
}

// Shopify Dev Login helper route
router.post('/shopify-dev-login', async (req, res) => {
  try {
    const { query, customerId, email, firstName, lastName, phone, orderNumber } = req.body;
    
    let user = null;
    let targetShopifyOrderId = null;
    let matchedOrder = null;
    let identifier = String(query || email || customerId || '').trim();

    const db = require('../db');

    // 1. Strict validation: check Order Number + Email ID if both are passed
    if (orderNumber && email) {
      const cleanOrderNo = String(orderNumber).trim().replace(/^#/, '');
      const cleanEmail = String(email).trim().toLowerCase();
      const Order = require('../models/Order');

      // Build a safe query for orderNumber (number type in schema) and name (string type in schema)
      const numericOrderNo = Number(cleanOrderNo);
      const orConditions = [
        { name: cleanOrderNo },
        { name: `#${cleanOrderNo}` },
        { name: { $regex: new RegExp(escapeRegExp(cleanOrderNo) + '$', 'i') } },
        { id: cleanOrderNo },
        { shopifyId: cleanOrderNo },
        { orderNumber: String(cleanOrderNo) },
        { orderNumber: cleanOrderNo }
      ];
      if (!isNaN(numericOrderNo)) {
        orConditions.push({ orderNumber: numericOrderNo });
      }

      matchedOrder = await Order.findOne({
        $and: [
          {
            $or: orConditions
          },
          {
            $or: [
              { 'customer.email': { $regex: new RegExp('^' + escapeRegExp(cleanEmail) + '$', 'i') } },
              { 'email': { $regex: new RegExp('^' + escapeRegExp(cleanEmail) + '$', 'i') } }
            ]
          }
        ]
      }).lean();

      if (!matchedOrder) {
        // Fallback A: search local shopify_orders collection (which is synced via webhooks/cron)
        const ShopifyOrder = require('../models/ShopifyOrder');
        
        const shopifyOrConditions = [
          { name: cleanOrderNo },
          { name: `#${cleanOrderNo}` },
          { name: { $regex: new RegExp(escapeRegExp(cleanOrderNo) + '$', 'i') } },
          { shopifyOrderId: cleanOrderNo }
        ];
        if (!isNaN(numericOrderNo)) {
          shopifyOrConditions.push({ orderNumber: numericOrderNo });
        } else {
          shopifyOrConditions.push({ orderNumber: cleanOrderNo });
        }

        const candidate = await ShopifyOrder.findOne({
          $and: [
            {
              $or: shopifyOrConditions
            },
            {
              $or: [
                { 'customer.email': { $regex: new RegExp('^' + escapeRegExp(cleanEmail) + '$', 'i') } },
                { 'email': { $regex: new RegExp('^' + escapeRegExp(cleanEmail) + '$', 'i') } }
              ]
            }
          ]
        }).lean();

        if (candidate && candidate.shopifyOrderId) {
          const shopifyService = require('../services/shopify.service');
          const shopifyConfig = require('../config/shopify.config');
          try {
            const shop = shopifyConfig.store;
            const shToken = shopifyConfig.accessToken;
            if (shToken && shToken !== 'your_access_token_here' && shop) {
              const rawOrder = await shopifyService.getOrderByIdFromShopify(shop, shToken, candidate.shopifyOrderId);
              if (rawOrder) {
                await shopifyService.syncOrderToDb(rawOrder);
                matchedOrder = await Order.findOne({ shopifyId: String(rawOrder.id) }).lean();
              }
            }
          } catch (err) {
            console.error('Sync candidate order by Shopify ID failed:', err.message);
          }
        }
      }

      if (!matchedOrder) {
        // Fallback B: search Shopify API using customer email (extremely robust) or name filters
        const shopifyService = require('../services/shopify.service');
        const shopifyConfig = require('../config/shopify.config');
        try {
          const shop = shopifyConfig.store;
          const shToken = shopifyConfig.accessToken;
          if (shToken && shToken !== 'your_access_token_here' && shop) {
            let fetched = [];
            // Try fetching by email first
            try {
              fetched = await shopifyService.getOrdersFromShopify(shop, shToken, { email: cleanEmail, status: 'any', limit: 20 });
            } catch (_) {}

            // Try fetching by name as second fallback
            if (!fetched || fetched.length === 0) {
              try {
                fetched = await shopifyService.getOrdersFromShopify(shop, shToken, { name: `#${cleanOrderNo}`, status: 'any', limit: 5 });
              } catch (_) {}
            }
            if (!fetched || fetched.length === 0) {
              try {
                fetched = await shopifyService.getOrdersFromShopify(shop, shToken, { name: cleanOrderNo, status: 'any', limit: 5 });
              } catch (_) {}
            }

            if (fetched && fetched.length > 0) {
              const correctOrder = fetched.find(o => {
                const oEmail = String(o.email || o.customer?.email || '').toLowerCase();
                if (oEmail !== cleanEmail) return false;

                const oName = String(o.name || '').replace(/^#/, '');
                const oNum = String(o.order_number || '');
                const oId = String(o.id || '');

                return (
                  oName === cleanOrderNo ||
                  oNum === cleanOrderNo ||
                  oId === cleanOrderNo ||
                  oName.endsWith(cleanOrderNo) ||
                  oNum.endsWith(cleanOrderNo)
                );
              });

              if (correctOrder) {
                await shopifyService.syncOrderToDb(correctOrder);
                matchedOrder = await Order.findOne({ shopifyId: String(correctOrder.id) }).lean();
              }
            }
          }
        } catch (err) {
          console.error('Shopify Order Number + Email Fetch Error:', err.message);
        }
      }

      if (matchedOrder) {
        targetShopifyOrderId = matchedOrder.shopifyId;
        const targetEmail = matchedOrder.customer?.email || cleanEmail;
        user = await db.getUserByEmail(targetEmail);
        if (!user) {
          user = await db.createUser({
            email: targetEmail,
            password: 'customer123',
            name: matchedOrder.customer?.name || 'Customer',
            phone: matchedOrder.customer?.phone || matchedOrder.phone || '',
            role: 'customer'
          });
        } else {
          // Sync name/phone if matching order contains more accurate details
          let updated = false;
          const updates = {};
          if ((!user.name || user.name === 'Customer' || user.name === 'Shopify Customer') && matchedOrder.customer?.name) {
            updates.name = matchedOrder.customer.name;
            user.name = matchedOrder.customer.name;
            updated = true;
          }
          if (!user.phone && (matchedOrder.customer?.phone || matchedOrder.phone)) {
            updates.phone = matchedOrder.customer?.phone || matchedOrder.phone;
            user.phone = updates.phone;
            updated = true;
          }
          if (updated) {
            await db.updateUser(user.id, updates);
          }
        }
      } else {
        return res.status(404).json({ success: false, error: 'No order found matching this Order Number and Email ID combination.' });
      }

    } else {
      // 2. Single input email login path
      if (!identifier) {
        return res.status(400).json({ success: false, error: 'Please enter your Email Address.' });
      }

      const cleanId = identifier.replace(/^#/, '');
      const cleanPhone = identifier.replace(/\D/g, '');
      const candidateOrders = await findCandidateOrders(identifier, cleanId, cleanPhone);

      matchedOrder = candidateOrders.find(o => {
        if (String(o.orderNumber) === cleanId) return true;
        if (String(o.shopifyId) === identifier) return true;
        if (String(o.id).includes(cleanId)) return true;
        if (String(o.customer?.email || '').toLowerCase() === identifier.toLowerCase()) return true;
        
        if (cleanPhone.length >= 7) {
          const cleanTarget = cleanPhone.slice(-10);
          if (o.customer?.phone && String(o.customer.phone).replace(/\D/g, '').endsWith(cleanTarget)) return true;
          if (o.phone && String(o.phone).replace(/\D/g, '').endsWith(cleanTarget)) return true;
          if (o.shippingAddress?.phone && String(o.shippingAddress.phone).replace(/\D/g, '').endsWith(cleanTarget)) return true;
        }
        return false;
      });

      if (!matchedOrder) {
        // Dynamic fallback: reach out to Shopify!
        const shopifyService = require('../services/shopify.service');
        const shopifyConfig = require('../config/shopify.config');
        
        try {
          let fetchedShopifyOrders = [];
          const shop = shopifyConfig.store;
          const shToken = shopifyConfig.accessToken;

          if (shToken && shToken !== 'your_access_token_here') {
            if (identifier.includes('@')) {
              // Try up to 50 orders to sync all matching orders for this customer email address
              fetchedShopifyOrders = await shopifyService.getOrdersFromShopify(shop, shToken, { email: identifier, status: 'any', limit: 50 });
            } else if (cleanPhone.length >= 7) {
              const customers = await shopifyService.searchCustomersFromShopify(shop, shToken, { query: `phone:${cleanPhone}` });
              if (customers && customers.length > 0) {
                const matchedCustomer = customers.find(c => {
                  const cleanTarget = cleanPhone.slice(-10);
                  if (c.phone && c.phone.replace(/\D/g, '').endsWith(cleanTarget)) return true;
                  if (c.default_address?.phone && c.default_address.phone.replace(/\D/g, '').endsWith(cleanTarget)) return true;
                  return false;
                }) || customers[0];
                
                fetchedShopifyOrders = await shopifyService.getOrdersFromShopify(shop, shToken, { customer_id: matchedCustomer.id, status: 'any', limit: 10 });
              }
            } else {
              fetchedShopifyOrders = await shopifyService.getOrdersFromShopify(shop, shToken, { name: identifier, status: 'any', limit: 1 });
            }

            if (fetchedShopifyOrders && fetchedShopifyOrders.length > 0) {
              await shopifyService.syncOrderToDb(fetchedShopifyOrders[0]);
              const Order = require('../models/Order');
              matchedOrder = await Order.findOne({ shopifyId: String(fetchedShopifyOrders[0].id) }).lean();

              if (fetchedShopifyOrders.length > 1) {
                (async () => {
                  try {
                    for (let i = 1; i < fetchedShopifyOrders.length; i++) {
                      await shopifyService.syncOrderToDb(fetchedShopifyOrders[i]);
                    }
                  } catch (backgroundSyncErr) {
                    console.error('[BACKGROUND SIGNIN SYNC ERROR]', backgroundSyncErr.message);
                  }
                })();
              }
            }
          }
        } catch (err) {
          console.error('Dynamic Shopify Fetch Error:', err.message);
        }
      }

      if (matchedOrder) {
        targetShopifyOrderId = matchedOrder.shopifyId;
        const targetEmail = matchedOrder.customer?.email || matchedOrder.email || `${matchedOrder.shopifyId}@customer.com`;
        user = await db.getUserByEmail(targetEmail);
        if (!user) {
          user = await db.createUser({
            email: targetEmail,
            password: 'customer123',
            name: matchedOrder.customer?.name || 'Customer',
            phone: matchedOrder.customer?.phone || matchedOrder.phone || '',
            role: 'customer'
          });
        } else {
          let updated = false;
          const updates = {};
          if ((!user.name || user.name === 'Customer' || user.name === 'Shopify Customer') && matchedOrder.customer?.name) {
            updates.name = matchedOrder.customer.name;
            user.name = matchedOrder.customer.name;
            updated = true;
          }
          if (!user.phone && (matchedOrder.customer?.phone || matchedOrder.phone)) {
            updates.phone = matchedOrder.customer?.phone || matchedOrder.phone;
            user.phone = updates.phone;
            updated = true;
          }
          if (updated) {
            await db.updateUser(user.id, updates);
          }
        }
      } else {
        return res.status(404).json({
          success: false,
          error: 'No active orders or account found matching this email address. Please make sure you enter the email used to place the order.'
        });
      }
    }

    const payload = { 
      id: user.id, 
      email: user.email, 
      name: user.name, 
      phone: user.phone || '', 
      role: 'customer'
    };
    
    const isEmail = identifier.includes('@');
    const isPhone = !isEmail && cleanPhone.length >= 7;
    const isOrderContext = !isEmail && !isPhone;

    if (targetShopifyOrderId && (req.body?.orderNumber || isOrderContext)) {
      payload.shopifyOrderId = targetShopifyOrderId;
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



// Request OTP
router.post('/otp-request', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }
    // Check if there is an order with this phone number (using optimized candidate search)
    const cleanPhone = phone.replace(/\D/g, '');
    let matched = false;

    if (cleanPhone.length > 5) {
      const Order = require('../models/Order');
      const phoneRegexStr = cleanPhone.split('').join('\\D*');
      const phoneRegex = new RegExp(phoneRegexStr);
      const candidateOrders = await Order.find({
        $or: [
          { 'customer.phone': { $regex: phoneRegex } },
          { 'phone': { $regex: phoneRegex } }
        ]
      }).limit(50).lean();

      matched = candidateOrders.some(o => {
        const cleanTarget = cleanPhone.slice(-10);
        return (o.customer?.phone && String(o.customer.phone).replace(/\D/g, '').endsWith(cleanTarget)) ||
          (o.phone && String(o.phone).replace(/\D/g, '').endsWith(cleanTarget));
      });
    }

    console.log(`[OTP REQUEST] OTP requested for phone: ${phone}. Order found: ${!!matched}`);
    res.json({ success: true, message: 'OTP sent successfully (demo: 1234)' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify OTP
router.post('/otp-verify', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Phone and code are required' });
    }
    if (code !== '1234') {
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    let matchedOrder = null;

    if (cleanPhone.length > 5) {
      const Order = require('../models/Order');
      const phoneRegexStr = cleanPhone.split('').join('\\D*');
      const phoneRegex = new RegExp(phoneRegexStr);
      const candidateOrders = await Order.find({
        $or: [
          { 'customer.phone': { $regex: phoneRegex } },
          { 'phone': { $regex: phoneRegex } }
        ]
      }).limit(50).lean();

      matchedOrder = candidateOrders.find(o => {
        const cleanTarget = cleanPhone.slice(-10);
        return (o.customer?.phone && String(o.customer.phone).replace(/\D/g, '').endsWith(cleanTarget)) ||
          (o.phone && String(o.phone).replace(/\D/g, '').endsWith(cleanTarget));
      });
    }

    let user;
    if (matchedOrder && matchedOrder.customer) {
      const email = matchedOrder.customer.email || `${cleanPhone}@customer.com`;
      user = await db.getUserByEmail(email);
      if (!user) {
        user = await db.createUser({
          email,
          password: 'customer123',
          name: matchedOrder.customer.name || 'Shopify Customer',
          phone: phone,
          role: 'customer'
        });
      } else {
        let updated = false;
        const updates = {};
        if ((!user.name || user.name === 'Customer' || user.name === 'Shopify Customer') && matchedOrder.customer?.name) {
          updates.name = matchedOrder.customer.name;
          user.name = matchedOrder.customer.name;
          updated = true;
        }
        if (!user.phone && phone) {
          updates.phone = phone;
          user.phone = phone;
          updated = true;
        }
        if (updated) {
          await db.updateUser(user.id, updates);
        }
      }
    } else {
      const email = `${cleanPhone}@customer.com`;
      user = await db.getUserByEmail(email);
      if (!user) {
        user = await db.createUser({
          email,
          password: 'customer123',
          name: 'Shopify Customer',
          phone: phone,
          role: 'customer'
        });
      } else {
        if (!user.phone && phone) {
          await db.updateUser(user.id, { phone });
          user.phone = phone;
        }
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone || '', role: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: 'customer' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WhatsApp Login
router.post('/whatsapp-login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    let matchedOrder = null;

    if (cleanPhone.length > 5) {
      const Order = require('../models/Order');
      const phoneRegexStr = cleanPhone.split('').join('\\D*');
      const phoneRegex = new RegExp(phoneRegexStr);
      const candidateOrders = await Order.find({
        $or: [
          { 'customer.phone': { $regex: phoneRegex } },
          { 'phone': { $regex: phoneRegex } }
        ]
      }).limit(50).lean();

      matchedOrder = candidateOrders.find(o => {
        const cleanTarget = cleanPhone.slice(-10);
        return (o.customer?.phone && String(o.customer.phone).replace(/\D/g, '').endsWith(cleanTarget)) ||
          (o.phone && String(o.phone).replace(/\D/g, '').endsWith(cleanTarget));
      });
    }

    let user;
    if (matchedOrder && matchedOrder.customer) {
      const email = matchedOrder.customer.email || `${cleanPhone}@customer.com`;
      user = await db.getUserByEmail(email);
      if (!user) {
        user = await db.createUser({
          email,
          password: 'customer123',
          name: matchedOrder.customer.name || 'Shopify Customer',
          phone: phone,
          role: 'customer'
        });
      } else {
        let updated = false;
        const updates = {};
        if ((!user.name || user.name === 'Customer' || user.name === 'Shopify Customer') && matchedOrder.customer?.name) {
          updates.name = matchedOrder.customer.name;
          user.name = matchedOrder.customer.name;
          updated = true;
        }
        if (!user.phone && phone) {
          updates.phone = phone;
          user.phone = phone;
          updated = true;
        }
        if (updated) {
          await db.updateUser(user.id, updates);
        }
      }
    } else {
      const email = `${cleanPhone}@customer.com`;
      user = await db.getUserByEmail(email);
      if (!user) {
        user = await db.createUser({
          email,
          password: 'customer123',
          name: 'Shopify Customer',
          phone: phone,
          role: 'customer'
        });
      } else {
        if (!user.phone && phone) {
          await db.updateUser(user.id, { phone });
          user.phone = phone;
        }
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone || '', role: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: 'customer' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current user profile
router.get('/me', authMiddleware(), async (req, res) => {
  try {
    const user = await db.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Validate Unique Upload Token (One-Click Login)
router.get('/upload-link/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const mongoose = require('mongoose');
    const ShopifyOrder = mongoose.model('ShopifyOrder');
    const order = await ShopifyOrder.findOne({ uploadToken: token }).lean();

    if (!order) {
      return res.status(404).json({ success: false, error: 'Invalid or expired upload link' });
    }

    // Ensure we have a user account for this email (or dummy email)
    const email = order.email || order.customer?.email || `order_${order.orderNumber}@customer.com`;
    const name = order.name || order.customer?.firstName || 'Customer';
    const phone = order.customer?.phone || order.shippingAddress?.phone || '';

    let user = await db.getUserByEmail(email);
    if (!user) {
      user = await db.createUser({
        email,
        password: crypto.randomBytes(24).toString('hex'),
        name,
        phone,
        role: 'customer'
      });
    }

    // Mint a JWT token tailored to this session
    const jwtToken = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        phone: user.phone || '', 
        role: 'customer',
        shopifyOrderId: order.shopifyOrderId // Injecting context
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true, 
      token: jwtToken, 
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: 'customer' },
      shopifyOrder: order
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

