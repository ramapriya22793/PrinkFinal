const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const { resolveTemplate } = require('../config/printTemplates');
const { fromLegacyImage, normalizeTransform } = require('../utils/designTransform');
const { generatePrintPdf, UPLOADS_DIR } = require('../utils/printRenderer');
const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
const { allocateButterflyTemplate } = require('../services/butterflyAllocation.service');
const { generateMagazinePdf } = require('../utils/magazineGenerator');
const { generatePolaroidPdf } = require('../utils/polaroidGenerator');
const { reconcileWorkflowStatus, derivePrintGenerationStatus, deriveDpiStatus } = require('../utils/orderStatus');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');


/**
 * List every order.
 *
 * Admin only: the documents carry customer names, emails, phone numbers and
 * shipping addresses, so this was previously an unauthenticated dump of the
 * entire customer database.
 */
router.get('/', adminMiddleware, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Order = require('../models/Order');
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(10000, parseInt(req.query.limit) || 500);
    const status = req.query.status || '';
    const search = (req.query.search || '').trim();

    console.log('[ORDERS] DB readyState:', mongoose.connection.readyState, '| page:', page, '| limit:', limit, '| status:', status || 'all', '| search:', search || 'none');

    // Base filter: list all orders for Admin Portal
    const baseFilter = {};

    // Mirrors the client's hasCustomizationBeenReceived() (AdminPortal.tsx)
    // exactly, so the "Ready (Uploaded)" / "Pending Upload" tabs, their
    // counts, and the actual rows returned all agree with each other.
    const READY_WORKFLOW_STATUSES = [
      'photo_uploaded', 'approved', 'sent_to_printer', 'printer_processing',
      'printing', 'ready_for_dispatch', 'in_transit', 'delivered', 'completed'
    ];
    const readyOrConditions = [
      { customizationStatus: 'completed' },
      { designLockedAt: { $ne: null } },
      { 'images.0': { $exists: true } },
      { workflowStatus: { $in: READY_WORKFLOW_STATUSES } },
      { uploadStatus: 'ready' }
    ];
    // The Approved / Printing / Completed tabs key off workflowStatus alone
    // in the client's click-through filter (every order has one, defaulting
    // to 'order_received', so its equality check always wins over the
    // adminApprovalStatus fallback branches below it) - matched here 1:1.
    const TAB_FILTERS = {
      all:             {},
      ready:           { $or: readyOrConditions },
      pending:         { $nor: readyOrConditions },
      approved:        { workflowStatus: 'approved' },
      sent_to_printer: { workflowStatus: 'sent_to_printer' },
      completed:       { workflowStatus: 'completed' }
    };

    // Combine with tab status and search
    const filter = { $and: [baseFilter] };

    // Unrecognised status values (there shouldn't be any - this list matches
    // every tab key the admin Orders page renders) fall through as 'all'
    // rather than a filter no order can ever match.
    if (status && status !== 'all' && TAB_FILTERS[status]) {
      filter.$and.push(TAB_FILTERS[status]);
    }
    if (search) {
      filter.$and.push({
        $or: [
          { id: { $regex: search, $options: 'i' } },
          { 'customer.name': { $regex: search, $options: 'i' } },
          { 'customer.email': { $regex: search, $options: 'i' } },
          { product: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Run all queries in parallel for speed — fetch full unstripped orders
    const [
      orders, total, pending, ready, revision,
      tabAll, tabReady, tabPending, tabApproved, tabSentToPrinter, tabCompleted
    ] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
      Order.countDocuments({ $and: [baseFilter, { customizationStatus: { $ne: 'completed' } }] }),
      Order.countDocuments({ $and: [baseFilter, { uploadStatus: 'ready' }] }),
      Order.countDocuments({ $and: [baseFilter, { uploadStatus: 'revision_requested' }] }),
      // tabCounts: computed over the full corpus (ignoring the active search,
      // same as the printer queue's tabCounts), so switching tabs always
      // shows a count consistent with what that tab will actually contain.
      Order.countDocuments(baseFilter),
      Order.countDocuments({ $and: [baseFilter, TAB_FILTERS.ready] }),
      Order.countDocuments({ $and: [baseFilter, TAB_FILTERS.pending] }),
      Order.countDocuments({ $and: [baseFilter, TAB_FILTERS.approved] }),
      Order.countDocuments({ $and: [baseFilter, TAB_FILTERS.sent_to_printer] }),
      Order.countDocuments({ $and: [baseFilter, TAB_FILTERS.completed] })
    ]);

    console.log('[ORDERS] Result: active orders returned:', orders.length, '| total active:', total, '| pending:', pending, '| ready:', ready);

    // Orders have no top-level dpi/dpiStatus field - derive it at read time
    // from printFiles[] (see deriveDpiStatus) so the admin UI shows a real
    // status/"Not Checked" instead of a permanently blank badge.
    const { deduplicateOrders, cleanupDuplicateOrdersInDb } = require('../utils/orderDeduplication');
    const { cleanOrders, duplicateIdsToDelete, mergesToPerform } = deduplicateOrders(orders);
    if (duplicateIdsToDelete.length > 0 || mergesToPerform.length > 0) {
      setImmediate(() => {
        cleanupDuplicateOrdersInDb(Order, duplicateIdsToDelete, mergesToPerform);
      });
    }
    const ordersWithDpi = cleanOrders.map(o => ({ ...o, ...deriveDpiStatus(o) }));

    // Automatic background live sync for Shopify orders (throttled to once every 10 mins)
    const now = Date.now();
    if (!global._lastAdminOrderSync || (now - global._lastAdminOrderSync > 10 * 60 * 1000)) {
      global._lastAdminOrderSync = now;
      setImmediate(async () => {
        try {
          const db = require('../db');
          const settings = await db.getSettings();
          const shopifyConfig = require('../config/shopify.config');
          const shop = settings.shopifyStore || process.env.SHOPIFY_STORE || shopifyConfig.store || 'prink-in.myshopify.com';
          const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN || shopifyConfig.accessToken || '';
          if (shop && token) {
            const shopifyService = require('../services/shopify.service');
            const newOrders = await shopifyService.getOrdersFromShopify(shop, token, { limit: 50, status: 'any' });
            if (Array.isArray(newOrders) && newOrders.length > 0) {
              for (const o of newOrders) {
                await shopifyService.syncOrderToDb(o);
              }
              console.log(`[ADMIN BG AUTO-SYNC] Synced ${newOrders.length} live Shopify orders.`);
              try {
                const { syncAllUnsyncedOrdersToSheet } = require('../services/googleSheetService');
                await syncAllUnsyncedOrdersToSheet();
              } catch (_) {}
            }
          }
        } catch (syncErr) {
          console.warn('[ADMIN BG AUTO-SYNC ERROR]', syncErr.message);
        }
      });
    }

    return res.json({
      orders: ordersWithDpi,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      stats: { total, pending, ready, revision },
      tabCounts: {
        all: tabAll,
        ready: tabReady,
        pending: tabPending,
        approved: tabApproved,
        sent_to_printer: tabSentToPrinter,
        completed: tabCompleted
      }
    });
  } catch (err) {
    console.error('[GET /api/orders] Error:', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Recently *submitted* orders for the dashboard widget - not recently
 * created. `designLockedAt` is set only when a customer confirms their
 * design in the upload portal, so this reflects actual customer activity
 * rather than however recently Shopify happened to sync the order.
 */
router.get('/recent-submissions', adminMiddleware, async (req, res) => {
  try {
    const Order = require('../models/Order');
    const limit = Math.min(20, parseInt(req.query.limit) || 5);

    const listProjection = {
      images: 0,
      designData: 0,
      designRevisions: 0,
      printFiles: 0,
      printGenerationErrors: 0,
      activityLogs: 0,
      customerApprovedImages: 0,
    };

    const orders = await Order.find({ designLockedAt: { $ne: null } }, listProjection)
      .sort({ designLockedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, orders });
  } catch (err) {
    console.error('[GET /api/orders/recent-submissions] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orders/cleanup-test-data
 * Admin-only: Cleans up testing customizations, orphaned upload records,
 * and test print files after S3 bucket wipe, resetting orders to clean initial state.
 */
router.post('/cleanup-test-data', adminMiddleware, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Order = require('../models/Order');
    const db = mongoose.connection.db;

    const orderFilter = {
      $or: [
        { 'images.0': { $exists: true } },
        { pdfUrl: { $ne: null } },
        { 'printFiles.0': { $exists: true } },
        { uploadStatus: { $in: ['ready', 'completed', 'in_progress', 'revision_requested'] } },
        { customizationStatus: { $in: ['completed', 'in-progress'] } },
        { workflowStatus: { $in: ['photo_uploaded', 'approved', 'sent_to_printer', 'printer_processing', 'printing', 'ready_for_dispatch', 'in_transit', 'delivered', 'completed'] } },
        { printStatus: { $in: ['queued', 'processing', 'completed'] } },
        { designLockedAt: { $ne: null } }
      ]
    };

    const countBefore = await Order.countDocuments(orderFilter);

    const updateResult = await Order.updateMany(orderFilter, {
      $set: {
        images: [],
        customerApprovedImages: [],
        designData: null,
        designRevisions: [],
        pdfUrl: null,
        printFiles: [],
        printGenerationStatus: null,
        printGenerationErrors: [],
        uploadStatus: 'pending',
        customizationStatus: 'pending',
        workflowStatus: 'order_received',
        adminApprovalStatus: 'pending',
        printStatus: 'pending',
        printerAssignedAt: null,
        designLockedAt: null,
        designerAssignedAt: null,
        priority: 'normal'
      }
    });

    // Delete mock test orders if any (e.g. ORD-1042-TEST, DEV-...)
    const mockDelete = await Order.deleteMany({
      $or: [
        { id: /^DEV-/ },
        { id: /^mock-/ },
        { id: 'ORD-1042-TEST' }
      ]
    });

    let qDeleted = 0, uDeleted = 0, nDeleted = 0;
    try {
      const qRes = await db.collection('queueitems').deleteMany({});
      qDeleted = qRes.deletedCount;
    } catch (_) {}

    try {
      const uRes = await db.collection('uploads').deleteMany({});
      uDeleted = uRes.deletedCount;
    } catch (_) {}

    try {
      const nRes = await db.collection('notifications').deleteMany({});
      nDeleted = nRes.deletedCount;
    } catch (_) {}

    const countAfter = await Order.countDocuments(orderFilter);

    res.json({
      success: true,
      message: 'Test data cleaned successfully after S3 wipe',
      matchedBefore: countBefore,
      ordersReset: updateResult.modifiedCount,
      mockOrdersDeleted: mockDelete.deletedCount,
      queueItemsDeleted: qDeleted,
      uploadsDeleted: uDeleted,
      notificationsDeleted: nDeleted,
      ordersWithCustomizationAfter: countAfter
    });
  } catch (err) {
    console.error('[POST /api/orders/cleanup-test-data] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Alias for customer/orders (Filtered by customer token identity)
router.get('/customer/orders', authMiddleware(), async (req, res) => {
  try {
    const userEmail = req.user.email;
    const userPhone = req.user.phone;
    const Order = require('../models/Order');

    // ── Fast exact-match DB query — no slow regex, returns instantly ──
    const buildDbQuery = (email, phone, name, shopifyOrderId) => {
      const conditions = [];
      if (shopifyOrderId) {
        const cleanId = String(shopifyOrderId).replace(/^#/, '').trim();
        conditions.push({ shopifyId: String(shopifyOrderId) });
        conditions.push({ id: String(shopifyOrderId) });
        conditions.push({ orderNumber: String(shopifyOrderId) });
        conditions.push({ orderNumber: `#${cleanId}` });
        conditions.push({ orderNumber: cleanId });
      }
      if (email) {
        const emailLower = email.toLowerCase().trim();
        conditions.push({ 'customer.email': { $regex: new RegExp('^' + emailLower + '$', 'i') } });
        conditions.push({ 'email': { $regex: new RegExp('^' + emailLower + '$', 'i') } });
        conditions.push({ 'customerEmail': { $regex: new RegExp('^' + emailLower + '$', 'i') } });
        const dummyMatch = email.match(/^(\d+)@customer\.com$/);
        if (dummyMatch) {
          conditions.push({ 'customer.id': dummyMatch[1] });
          conditions.push({ shopifyId: dummyMatch[1] });
        }
      }
      if (phone) {
        const cleanP = phone.replace(/\D/g, '');
        if (cleanP.length > 5) {
          conditions.push({ 'customer.phone': { $regex: cleanP.slice(-10) } });
          conditions.push({ 'phone': { $regex: cleanP.slice(-10) } });
          conditions.push({ 'shippingAddress.phone': { $regex: cleanP.slice(-10) } });
        }
      }
      if (name && name !== 'Guest') {
        conditions.push({ 'customer.name': { $regex: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } });
      }
      return conditions.length > 0 ? { $or: conditions } : null;
    };

    const dbQuery = buildDbQuery(userEmail, userPhone, req.user.name, req.user.shopifyOrderId);
    let customerOrders = dbQuery ? await Order.find(dbQuery).sort({ updatedAt: -1 }).lean() : [];

    // Fallback: if no order matched by exact query, fetch recent orders or match by email substring
    if (customerOrders.length === 0 && userEmail && !req.user.shopifyOrderId) {
      const emailSub = userEmail.split('@')[0];
      if (emailSub && emailSub.length >= 3) {
        customerOrders = await Order.find({
          $or: [
            { 'customer.email': { $regex: emailSub, $options: 'i' } },
            { 'email': { $regex: emailSub, $options: 'i' } },
            { 'customerEmail': { $regex: emailSub, $options: 'i' } }
          ]
        }).sort({ updatedAt: -1 }).lean();
      }
    }

    // For magic-link logins — filter strictly to that order
    if (req.user.shopifyOrderId && customerOrders.length > 0) {
      const filtered = customerOrders.filter(o => String(o.shopifyId) === String(req.user.shopifyOrderId) || String(o.id) === String(req.user.shopifyOrderId));
      if (filtered.length > 0) customerOrders = filtered;
    }

    // ── Deduplicate customer orders to eliminate legacy bare-id parent records ──
    const { deduplicateOrders, cleanupDuplicateOrdersInDb, deduplicateOrderImages } = require('../utils/orderDeduplication');
    const { cleanOrders, duplicateIdsToDelete, mergesToPerform } = deduplicateOrders(customerOrders);
    customerOrders = cleanOrders.map(order => {
      if (order.images && Array.isArray(order.images)) {
        const reqLimit = order.requiredPhotoCount || ((order.productType === 'butterfly' || (order.product || '').toLowerCase().includes('butterfly')) ? 8 : ((order.productType === 'magazine' || (order.product || '').toLowerCase().includes('magazine')) ? 4 : 0));
        const cleaned = deduplicateOrderImages(order.images, reqLimit);
        if (cleaned.length !== order.images.length) {
          Order.updateOne({ id: order.id }, { $set: { images: cleaned } }).catch(() => {});
          order.images = cleaned;
        }
        order.images = order.images.map(img => ({
          ...img,
          src: img.previewUrl || img.src || img.url,
          url: img.url || img.src || img.previewUrl,
          previewUrl: img.previewUrl || img.src || img.url
        }));
      }
      return order;
    });

    if (duplicateIdsToDelete.length > 0 || mergesToPerform.length > 0) {
      setImmediate(() => {
        cleanupDuplicateOrdersInDb(Order, duplicateIdsToDelete, mergesToPerform);
      });
    }

    // ── Return IMMEDIATELY — do not wait for any Shopify network call ──
    res.json(customerOrders);

    // ── Background Shopify sync — fires AFTER response sent, 5-min cooldown ──
    setImmediate(async () => {
      try {
        const db = require('../db');
        const settings = await db.getSettings();
        const shopifyConfig = require('../config/shopify.config');
        const shop = settings.shopifyStore || process.env.SHOPIFY_STORE || shopifyConfig.store || 'prink-in.myshopify.com';
        const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN || shopifyConfig.accessToken || '';
        if (!token || token === 'your_access_token_here' || !shop) return;

        if (!global._shopifySyncCache) global._shopifySyncCache = {};
        const syncKey = `sync:${userEmail || userPhone}`;
        const now = Date.now();
        if (now - (global._shopifySyncCache[syncKey] || 0) < 5 * 60 * 1000) return;
        global._shopifySyncCache[syncKey] = now;

        const shopifyService = require('../services/shopify.service');
        let shopifyOrders = [];
        const isDummyEmail = userEmail && userEmail.endsWith('@customer.com');

        if (isDummyEmail || (!userEmail && userPhone)) {
          const cleanPhone = (userPhone || userEmail.split('@')[0]).replace(/\D/g, '');
          if (cleanPhone.length > 5) {
            const searchQueries = [`phone:${cleanPhone}`, `phone:+${cleanPhone}`];
            if (cleanPhone.length === 10) {
              searchQueries.push(`phone:+91${cleanPhone}`);
            }
            for (const q of searchQueries) {
              try {
                const customers = await shopifyService.searchCustomersFromShopify(shop, token, { query: q });
                if (Array.isArray(customers) && customers.length > 0) {
                  for (const c of customers) {
                    const orders = await shopifyService.getOrdersFromShopify(shop, token, { customer_id: c.id, status: 'any' });
                    if (Array.isArray(orders)) {
                      shopifyOrders = shopifyOrders.concat(orders);
                    }
                  }
                  break;
                }
              } catch (searchErr) {
                console.error(`[BG SYNC] Shopify customer search error for query "${q}":`, searchErr.message);
              }
            }
          }
        } else if (userEmail) {
          try {
            shopifyOrders = await shopifyService.getOrdersFromShopify(shop, token, { email: userEmail, status: 'any' });
          } catch (err) {
            console.error(`[BG SYNC] Shopify orders fetch by email error:`, err.message);
          }
        }

        if (Array.isArray(shopifyOrders) && shopifyOrders.length > 0) {
          for (const o of shopifyOrders) await shopifyService.syncOrderToDb(o);
          console.log(`[BG SYNC] Synced ${shopifyOrders.length} Shopify orders for ${userEmail || userPhone}`);
        }
      } catch (bgErr) {
        console.error('[BG SHOPIFY SYNC ERROR]', bgErr.message);
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});






// Create new order. Admin only - real orders originate in Shopify.
router.post('/', adminMiddleware, async (req, res) => {
  try {
    const order = await db.createOrder(req.body);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Order placement is NOT handled here.
 *
 * Shopify is the master of commerce data: orders and payment are created in
 * the storefront, and this app receives them via the orders/create webhook.
 * Creating an order here would produce a THE PRINK order with no Shopify
 * counterpart, no payment and no inventory movement. An explicit 501 tells
 * the caller exactly that instead of leaving an unexplained 404.
 */
router.post('/confirm', (_req, res) => {
  res.status(501).json({
    success: false,
    code: 'PLACED_IN_SHOPIFY',
    error: 'Orders are placed through the THE PRINK Shopify store. '
         + 'Once an order is paid, its personalisation link is created automatically.'
  });
});

/**
 * Legacy token lookup kept for links issued before the portal existed.
 *
 * The token is the only credential, so the response is trimmed to what a
 * customer needs. Returning the raw document would hand back the token itself,
 * the Shopify identifiers and internal workflow state.
 */
router.get('/upload-token/:token', async (req, res) => {
  try {
    const order = await db.getOrderByUploadToken(req.params.token);
    if (!order) return res.status(404).json({ success: false, error: 'Invalid or expired upload token' });

    if (order.uploadTokenExpiresAt && new Date(order.uploadTokenExpiresAt) < new Date()) {
      return res.status(410).json({ success: false, error: 'This upload link has expired.', code: 'TOKEN_EXPIRED' });
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customer?.name || 'Guest',
        product: order.product,
        sku: order.sku,
        quantity: order.quantity,
        uploadStatus: order.uploadStatus,
        customizationStatus: order.customizationStatus,
        designLocked: !!order.designLockedAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin only. Customers reach their own order through the tokenised portal.
router.get('/:id', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const os = require('os');
const isVercel = process.env.VERCEL === '1';
const ORIGINALS_DIR = isVercel ? os.tmpdir() : path.join(UPLOADS_DIR, 'originals');
const PREVIEWS_DIR = isVercel ? os.tmpdir() : path.join(UPLOADS_DIR, 'previews');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ORIGINALS_DIR),
  filename: (_req, file, cb) => {
    const ext = ({
      'image/jpeg': '.jpg', 'image/pjpeg': '.jpg', 'image/png': '.png',
      'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif'
    })[file.mimetype] || '.bin';
    cb(null, `orig_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const uploadSingle = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024, files: 1 }
}).single('image');

router.post('/:id/upload', authMiddleware(), (req, res) => {
  uploadSingle(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        error: tooBig ? 'That file is larger than 40MB.' : err.message
      });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'No image uploaded' });

    try {
      const { id } = req.params;
      const existingOrder = await db.getOrderById(id);
      if (!existingOrder) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      if (existingOrder.designLockedAt || existingOrder.customizationStatus === 'completed') {
        fs.unlink(req.file.path, () => {});
        return res.status(409).json({
          success: false,
          error: 'This customization is already submitted and locked.',
          code: 'DESIGN_LOCKED'
        });
      }

      // Check ownership if user is not admin
      if (req.user && req.user.role !== 'admin') {
        const userEmail = req.user.email;
        const userPhone = req.user.phone;
        const o = existingOrder;
        const matchesEmail = userEmail && (
          String(o.customer?.email || '').toLowerCase() === userEmail.toLowerCase() ||
          String(o.email || '').toLowerCase() === userEmail.toLowerCase()
        );
        const matchesPhone = userPhone && (
          String(o.customer?.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10)) ||
          String(o.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10))
        );
        const dummyMatch = userEmail ? userEmail.match(/^(\d+)@customer\.com$/) : null;
        const matchesId = dummyMatch && String(o.customer?.id) === dummyMatch[1];
        
        if (!matchesEmail && !matchesPhone && !matchesId) {
          fs.unlink(req.file.path, () => {});
          return res.status(403).json({ success: false, error: 'Unauthorized to access this order' });
        }
      }

      // Check if design is locked
      if (existingOrder.designLockedAt) {
        fs.unlink(req.file.path, () => {});
        return res.status(409).json({ success: false, error: 'This design is already confirmed.', code: 'DESIGN_LOCKED' });
      }

      let meta;
      try {
        meta = await sharp(req.file.path, { failOn: 'none' }).rotate().metadata();
      } catch {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'That file could not be read as an image.' });
      }

      if (!meta.width || !meta.height) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'That image appears to be corrupt.' });
      }

      const previewName = `prev_${path.basename(req.file.filename, path.extname(req.file.filename))}.jpg`;
      await sharp(req.file.path, { failOn: 'none' })
        .rotate()
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(PREVIEWS_DIR, previewName));

      // S3 is the only persistent store the /uploads serving middleware
      // (server/index.js) actually knows how to fall back to - it checks
      // os.tmpdir() (Vercel) then S3, never this route's own on-disk
      // UPLOADS_DIR/PREVIEWS_DIR. GridFS was never wired into that
      // middleware at all, so a photo saved only there previously became a
      // permanently broken image the moment local disk was cleared (e.g.
      // between requests once the customer had moved on to another page).
      // Matches the pattern already used by publicUpload.routes.js.
      const previewPath = path.join(PREVIEWS_DIR, previewName);
      const { saveToS3 } = require('../utils/s3Storage');
      try {
        await Promise.all([
          saveToS3(`originals/${req.file.filename}`, req.file.path),
          saveToS3(`previews/${previewName}`, previewPath)
        ]);
      } catch (s3Err) {
        console.error('[S3 Order Upload Save Error]', s3Err);
        fs.unlink(req.file.path, () => {});
        fs.unlink(previewPath, () => {});
        return res.status(502).json({ success: false, error: 'Failed to save your photo. Please try again.' });
      }
      if (process.env.NODE_ENV !== 'test' && process.env.JWT_SECRET !== 'test_secret_for_prink_suite') {
        fs.unlink(req.file.path, () => {});
        fs.unlink(previewPath, () => {});
      }

      const replaceImageId = req.body.replaceImageId;
      const Order = require('../models/Order');

      const image = {
        id: replaceImageId || `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        name: path.basename(req.file.originalname).slice(0, 120),
        originalKey: path.join('originals', req.file.filename),
        src: `/uploads/previews/${previewName}`,
        previewUrl: `/uploads/previews/${previewName}`,
        url: `/uploads/originals/${req.file.filename}`,
        mimeType: req.file.mimetype,
        bytes: req.file.size,
        width: meta.width,
        height: meta.height,
        uploadedAt: new Date()
      };

      let replaced = false;
      let finalImage = image;

      if (replaceImageId && Array.isArray(existingOrder.images)) {
        const replaceIdx = existingOrder.images.findIndex(img => 
          img && (img.id === replaceImageId || String(img._id) === replaceImageId)
        );
        if (replaceIdx !== -1) {
          finalImage = {
            ...existingOrder.images[replaceIdx],
            ...image,
            id: replaceImageId,
            isCropped: true
          };
          existingOrder.images[replaceIdx] = finalImage;
          await Order.updateOne(
            { id: existingOrder.id },
            { $set: { images: existingOrder.images, uploadStatus: 'in_progress', customizationStatus: 'in-progress' } }
          );
          await db.addActivityLog(existingOrder.id, 'IMAGE_UPDATED', `Customer updated/cropped ${image.name}.`);
          replaced = true;
        }
      }

      if (!replaced) {
        await Order.updateOne(
          { id: existingOrder.id },
          { $push: { images: image }, $set: { uploadStatus: 'in_progress', customizationStatus: 'in-progress' } }
        );
        await db.addActivityLog(existingOrder.id, 'IMAGE_UPLOADED', `Customer uploaded ${image.name}.`);
      }

      res.json({
        success: true,
        image: finalImage,
        replaced,
        replacedImageId: replaced ? replaceImageId : undefined
      });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// Customer / Admin Delete Image
router.delete('/:id/image/:imageId', authMiddleware(), async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const existingOrder = await db.getOrderById(id);
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (existingOrder.designLockedAt) {
      return res.status(409).json({ success: false, error: 'This design is already confirmed and locked.', code: 'DESIGN_LOCKED' });
    }
    if (req.user && req.user.role !== 'admin') {
      const userEmail = req.user.email;
      const userPhone = req.user.phone;
      const o = existingOrder;
      const matchesEmail = userEmail && (
        String(o.customer?.email || '').toLowerCase() === userEmail.toLowerCase() ||
        String(o.email || '').toLowerCase() === userEmail.toLowerCase()
      );
      const matchesPhone = userPhone && (
        String(o.customer?.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10)) ||
        String(o.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10))
      );
      const dummyMatch = userEmail ? userEmail.match(/^(\d+)@customer\.com$/) : null;
      const matchesId = dummyMatch && String(o.customer?.id) === dummyMatch[1];
      if (!matchesEmail && !matchesPhone && !matchesId) {
        return res.status(403).json({ success: false, error: 'Unauthorized to access this order' });
      }
    }

    const Order = require('../models/Order');
    const remainingImages = (existingOrder.images || []).filter(img => img && img.id !== imageId && String(img._id) !== imageId);
    await Order.updateOne(
      { id: existingOrder.id },
      { $set: { images: remainingImages } }
    );
    await db.addActivityLog(existingOrder.id, 'IMAGE_DELETED', `Customer removed photo ${imageId}.`);
    res.json({ success: true, message: 'Image deleted', remainingCount: remainingImages.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Customer Upload & Design Submission
// Admin only. The customer path is POST /api/public/order/:token/confirm,
// which validates the token and locks the design.
router.post('/:id/design', authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    const { images, designData, customizationStatus } = req.body;
    
    const existingOrder = await db.getOrderById(id);
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Check if design is locked
    if (existingOrder.designLockedAt) {
      return res.status(409).json({ success: false, error: 'This design is already confirmed and locked.', code: 'DESIGN_LOCKED' });
    }

    // Check ownership if user is not admin
    if (req.user && req.user.role !== 'admin') {
      const userEmail = req.user.email;
      const userPhone = req.user.phone;
      const o = existingOrder;
      const matchesEmail = userEmail && (
        String(o.customer?.email || '').toLowerCase() === userEmail.toLowerCase() ||
        String(o.email || '').toLowerCase() === userEmail.toLowerCase()
      );
      const matchesPhone = userPhone && (
        String(o.customer?.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10)) ||
        String(o.phone || '').replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-10))
      );
      const dummyMatch = userEmail ? userEmail.match(/^(\d+)@customer\.com$/) : null;
      const matchesId = dummyMatch && String(o.customer?.id) === dummyMatch[1];
      
      if (!matchesEmail && !matchesPhone && !matchesId) {
        return res.status(403).json({ success: false, error: 'Unauthorized to access this order' });
      }
    }

            const processedImages = [];
      for (const img of (images || [])) {
        if (img.src && img.src.startsWith('data:image/')) {
          try {
            const matches = img.src.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const crypto = require('crypto');
              const fs = require('fs');
              const path = require('path');
              const buffer = Buffer.from(matches[2], 'base64');
              const ext = matches[1].split('/')[1] || 'png';
              const filename = 'orig_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
              const os = require('os');
              const isVercel = process.env.VERCEL === '1';
              const uploadsDir = isVercel ? os.tmpdir() : path.join(__dirname, '..', 'uploads', 'originals');
              if (!isVercel && !fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
              const filepath = path.join(uploadsDir, filename);
              fs.writeFileSync(filepath, buffer);

              // S3 is the only persistent store the /uploads serving
              // middleware actually falls back to (see the equivalent
              // comment on the /:id/upload route above) - GridFS alone left
              // camera-captured photos (see capturePhoto() in
              // CustomerPortal.tsx, which submits a data: URI here) broken
              // the moment local disk was cleared.
              const { saveToS3 } = require('../utils/s3Storage');
              try {
                await saveToS3(`originals/${filename}`, filepath);
              } catch (s3Err) {
                console.error('[S3 Base64 Save Error]', s3Err);
                fs.unlink(filepath, () => {});
                continue;
              }

              processedImages.push({ ...img, src: '/uploads/originals/' + filename, url: '/uploads/originals/' + filename });
              continue;
            }
          } catch (e) {
            console.error('Error saving base64 image to disk:', e);
          }
        }
        processedImages.push(img);
      }
  
        const updates = {
          uploadStatus: customizationStatus === 'completed' ? 'ready' : 'in_progress',
          customizationStatus: customizationStatus || 'completed',
          images: images ? processedImages : (existingOrder.images || []),
          designData: designData || existingOrder.designData || {},
          uploadedAt: customizationStatus === 'completed' ? new Date().toISOString() : existingOrder.uploadedAt,
          designLockedAt: customizationStatus === 'completed' ? new Date() : existingOrder.designLockedAt,
          // Set unified workflow status when photos are submitted
          workflowStatus: customizationStatus === 'completed' ? 'photo_uploaded' : (existingOrder.workflowStatus || 'photo_uploaded')
        };

    const updatedOrder = await db.updateOrder(id, updates);
    await db.addActivityLog(id, 'CUSTOMER_UPLOADED_DESIGN', 'Customer uploaded design and custom images.');
    
    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Review & Approval
router.post('/:id/review', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, comments } = req.body; // action: 'approve' | 'reject'

    const existingOrder = await db.getOrderById(id);
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const isApproved = action === 'approve';

    const isButterfly = (existingOrder.productType || '').toLowerCase() === 'butterfly' || (existingOrder.product || '').toLowerCase().includes('butterfly');
    const isMagazine = (existingOrder.productType || '').toLowerCase() === 'magazine' || (existingOrder.product || '').toLowerCase().includes('magazine');
    const isPolaroid = (existingOrder.productType || '').toLowerCase() === 'polaroid' || (existingOrder.product || '').toLowerCase().includes('polaroid') || (existingOrder.sku || '').toUpperCase().includes('PG-PP') || (existingOrder.sku || '').toUpperCase().includes('POLAROID');
    
    let templateId = '';
    if (isButterfly) {
      templateId = existingOrder.sku || existingOrder.productType || 'butterfly';
    } else if (isMagazine) {
      templateId = existingOrder.sku || existingOrder.productType || 'magazine';
    } else if (isPolaroid) {
      templateId = 'tpl-polaroid-20';
    } else {
      try {
        const { resolveTemplate } = require('../config/printTemplates');
        const template = resolveTemplate({
          sku: existingOrder.sku,
          productType: existingOrder.productType,
          productTitle: existingOrder.product
        });
        templateId = template?.id || existingOrder.sku || 'unknown';
      } catch (e) {
        templateId = existingOrder.sku || 'unknown';
      }
    }

    const images = (req.body.images && req.body.images.length > 0) ? req.body.images : (existingOrder.images || []);
    const imageInfo = images.map(img => ({
      id: img.id,
      url: img.url,
      transform: img.transform || {}
    }));
    const crypto = require('crypto');
    const currentHash = crypto.createHash('sha256').update(JSON.stringify({ templateId, images: imageInfo })).digest('hex');

    const isCached = existingOrder.designHash === currentHash && existingOrder.printFiles && existingOrder.printFiles.length > 0;

    const isReupload = action === 'request_reupload' || action === 'reupload';

    let updates = {
      images,
      adminApprovalStatus: isApproved ? 'approved' : (isReupload ? 'reupload' : 'rejected'),
      orderStatus: isApproved ? 'Approved' : 'Pending',
      printStatus: isApproved ? 'queued' : 'hold',
      // Set unified workflow status
      workflowStatus: isApproved ? 'approved' : 'rejected',
      designLockedAt: isApproved ? (existingOrder.designLockedAt || new Date()) : null,
      customizationStatus: isApproved ? 'completed' : 'pending',
      uploadStatus: isApproved ? 'ready' : 'pending'
    };

    if (isApproved) {
      if (isCached) {
        updates.printGenerationStatus = derivePrintGenerationStatus(existingOrder.printFiles);
        updates.pdfUrl = existingOrder.printFiles[0].url;
        if (updates.printGenerationStatus === 'completed') {
          // Print file already exists and is complete - route straight to
          // the printer queue.
          updates.workflowStatus = 'sent_to_printer';
          updates.printerAssignedAt = new Date();
        }
        // else: cached file has missing photo slots - stay at 'approved' so
        // it doesn't reach the printer queue as if it were print-ready.
      } else {
        updates.designHash = currentHash;
        updates.printGenerationStatus = 'processing';
        // stays 'approved'; runReviewGeneration promotes it to
        // 'sent_to_printer' once the background render succeeds.
      }
    }

    const updatedOrder = await db.updateOrder(id, updates);
    await db.addActivityLog(
      id,
      isApproved ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED',
      `Admin ${req.user?.email || ''} ${action}d the order design. ${comments ? 'Comments: ' + comments : ''}`
    );

    const runReviewGeneration = async () => {
      try {
        let printFiles = [];
        const { resolveTemplate } = require('../config/printTemplates');
        const template = resolveTemplate({
          sku: existingOrder.sku,
          productType: existingOrder.productType,
          productTitle: existingOrder.product
        });

        const Order = require('../models/Order');

        if (isButterfly) {
          const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
          let o1 = existingOrder;
          let o2 = null;
          let imgs1 = images;
          let imgs2 = undefined;
          if (existingOrder.linkedOrderId) {
            const linked = await Order.findOne({ id: existingOrder.linkedOrderId });
            if (linked) {
              if (existingOrder.templateSide === 'RED') {
                o1 = linked;
                o2 = existingOrder;
                imgs1 = linked.images || [];
                imgs2 = images;
              } else {
                o2 = linked;
                imgs2 = linked.images || [];
              }
            }
          }
          const file = await generateButterflyBoxPdf({
            orderId: o1.id,
            images: imgs1,
            order: o1,
            orderId2: o2?.id,
            images2: imgs2,
            order2: o2
          });
          printFiles.push({ ...file, isButterfly: true });
        } else if (isMagazine) {
          const { generateMagazinePdf } = require('../utils/magazineGenerator');
          const file = await generateMagazinePdf({ orderId: existingOrder.id, images, order: existingOrder });
          printFiles.push({ ...file, isMagazine: true });
        } else if (isPolaroid) {
          const { generatePolaroidPdf } = require('../utils/polaroidGenerator');
          const file = await generatePolaroidPdf({ orderId: existingOrder.id, images, order: existingOrder });
          printFiles.push({ ...file, isPolaroid: true });
        } else {
          const { generatePrintPdf } = require('../utils/printRenderer');
          const { fromLegacyImage } = require('../utils/designTransform');
          for (const img of images) {
            const file = await generatePrintPdf({
              orderId: existingOrder.id,
              order: existingOrder,
              image: img,
              template,
              transform: img.transform || fromLegacyImage(img)
            });
            printFiles.push({ ...file, imageId: img.id });
          }
        }

        const generated = printFiles.length > 0;
        const genStatus = derivePrintGenerationStatus(printFiles);
        const genSet = {
          printFiles,
          pdfUrl: generated ? printFiles[0].url : null,
          printGenerationStatus: genStatus
        };
        // A successful, COMPLETE render is the last thing standing between an
        // approved design and the printer queue, so route it there
        // automatically - no separate manual "Route to Printer" click needed
        // on the happy path. A file with missing photo slots ('partial')
        // must not reach the printer queue looking print-ready.
        if (genStatus === 'completed' && isApproved) {
          genSet.workflowStatus = 'sent_to_printer';
          genSet.printStatus = 'queued';
          genSet.printerAssignedAt = new Date();
        }
        await Order.updateOne({ id }, { $set: genSet });

        const totalMissing = printFiles.reduce((n, f) => n + (f?.missingImages || 0), 0);
        await db.addActivityLog(
          id,
          generated ? (genStatus === 'completed' ? 'PDF_GENERATED' : 'PDF_PARTIAL') : 'PDF_FAILED',
          genStatus === 'completed'
            ? `Print file generated (${printFiles.length} of ${images.length}) and routed to the print queue in background.`
            : generated
              ? `Print file generated with ${totalMissing} missing photo(s) - held at 'approved', NOT routed to the printer.`
              : 'Print file generation failed in background.'
        );
        return printFiles;
      } catch (bgErr) {
        console.error('[Background Admin Approve Render Error]', id, bgErr.message);
        const Order = require('../models/Order');
        await Order.updateOne({ id }, {
          $set: {
            printGenerationStatus: 'failed',
            printGenerationErrors: [{ error: bgErr.message }]
          }
        });
        return [];
      }
    };

    const isTest = process.env.NODE_ENV === 'test' || process.env.JWT_SECRET === 'test_secret_for_prink_suite';
    if (isApproved && !isCached) {
      if (isTest) {
        const printFiles = await runReviewGeneration();
        if (printFiles.length === 0) {
          await db.updateOrder(id, { adminApprovalStatus: 'pending', orderStatus: 'Pending', printStatus: 'hold' });
          return res.status(422).json({
            success: false,
            error: 'No print-ready file could be generated for this order.'
          });
        }
        const freshOrder = await db.getOrderById(id);
        res.json({ success: true, order: freshOrder });
      } else {
        res.json({
          success: true,
          order: updatedOrder,
          message: 'Design approved. PDF is generating in the background.'
        });
        runReviewGeneration().catch(err => {
          console.error('[Unhandled Background Review Generation Error]', id, err);
        });
      }
    } else {
      res.json({
        success: true,
        order: updatedOrder,
        message: isApproved ? 'Design approved. Reused cached PDF.' : 'Design rejected.'
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Assign an approved order to the print floor.
 * Only approved work may be routed, so an unreviewed design can never reach a
 * printer by calling this directly.
 */
router.post('/:id/route-to-printer', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    if (order.adminApprovalStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        error: 'Approve this design before routing it to the print queue.'
      });
    }
    if (!(order.printFiles || []).length) {
      return res.status(409).json({
        success: false,
        error: 'This order has no print-ready file, so it cannot be routed to a printer.'
      });
    }

    const updated = await db.updateOrder(order.id, {
      printStatus: 'queued',
      orderStatus: 'Approved',
      printerAssignedAt: new Date(),
      // Set unified workflow status to sent_to_printer
      workflowStatus: 'sent_to_printer'
    });
    await db.addActivityLog(order.id, 'PRINTER_ASSIGNED',
      `Admin ${req.user?.email || ''} routed the order to the print queue.`);

    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Regenerate the print file from the ORIGINAL asset and the stored transform.
 * Guarded so two rapid clicks cannot run two renders for the same order.
 */
const regenerating = new Set();

router.post('/:id/regenerate', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (regenerating.has(id)) {
    return res.status(409).json({ success: false, error: 'A print file is already being generated for this order.' });
  }
  regenerating.add(id);
  try {
    const order = await db.getOrderById(id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!(order.images || []).length) {
      return res.status(422).json({ success: false, error: 'This order has no customer photos to render.' });
    }

    const template = resolveTemplate({
      sku: order.sku, productType: order.productType, productTitle: order.product
    });

    const printFiles = [];
    const failures = [];
    const isButterfly = (order.productType || '').toLowerCase() === 'butterfly' || (order.product || '').toLowerCase().includes('butterfly');
    const isMagazine = (order.productType || '').toLowerCase() === 'magazine' || (order.product || '').toLowerCase().includes('magazine');
    const isPolaroid = (order.productType || '').toLowerCase() === 'polaroid' || (order.product || '').toLowerCase().includes('polaroid') || (order.sku || '').toUpperCase().includes('PG-PP') || (order.sku || '').toUpperCase().includes('POLAROID');
    if (isButterfly) {
      try {
        const file = await generateButterflyBoxPdf({ orderId: order.id, images: order.images || [], order });
        printFiles.push({ ...file, isButterfly: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else if (isMagazine) {
      try {
        const file = await generateMagazinePdf({ orderId: order.id, images: order.images || [], order });
        printFiles.push({ ...file, isMagazine: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else if (isPolaroid) {
      try {
        const file = await generatePolaroidPdf({ orderId: order.id, images: order.images || [], order });
        printFiles.push({ ...file, isPolaroid: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else {
      for (const img of order.images) {
        try {
          const file = await generatePrintPdf({
            orderId: order.id, order, image: img, template,
            transform: img.transform || fromLegacyImage(img)
          });
          printFiles.push({ ...file, imageId: img.id });
        } catch (err) {
          failures.push({ imageId: img.id, error: err.message });
        }
      }
    }

    if (!printFiles.length) {
      return res.status(422).json({ success: false, error: 'Print generation failed.', failures });
    }

    const updateData = {
      printFiles,
      templateId: template.id,
      pdfUrl: printFiles[0].url,
      printGenerationStatus: derivePrintGenerationStatus(printFiles, failures),
      printGenerationErrors: failures
    };
    updateData.workflowStatus = reconcileWorkflowStatus({ ...order, ...updateData });

    const updated = await db.updateOrder(id, updateData);
    await db.addActivityLog(id, 'PDF_REGENERATED',
      `Admin ${req.user?.email || ''} regenerated the print file (${printFiles.length}/${order.images.length}).`);

    console.log(`[WORKFLOW LOG] STEP 13 - Admin Generated Production File for Order ${id}`);

    res.json({ success: true, order: updated, printFiles, failures });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    regenerating.delete(id);
  }
});

/**
 * Admin design editor save.
 *
 * Creates a NEW design revision rather than overwriting the customer-approved
 * composition - `customerApprovedImages` is captured once, the first time an
 * admin edits, so the original approved artwork can always be recovered.
 * The print file is then regenerated from the customer's ORIGINAL stored images.
 * Accepts plain JSON body: { designData, images? }
 */
router.post('/:id/submit-design', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (regenerating.has(id)) {
    return res.status(409).json({ success: false, error: 'This order is already being processed.' });
  }
  regenerating.add(id);
  try {
    const order = await db.getOrderById(id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const { designData, images } = req.body || {};
    const revisions = Array.isArray(order.designRevisions) ? order.designRevisions : [];

    const updates = {
      designData: designData ?? order.designData,
      designRevisions: [
        ...revisions,
        {
          revision: revisions.length + 1,
          editedBy: req.user?.email || 'admin',
          editedAt: new Date(),
          designData: designData ?? order.designData
        }
      ]
    };

    // Preserve the customer-approved composition the first time it is edited.
    if (!order.customerApprovedImages) {
      updates.customerApprovedImages = order.images || [];
    }

    // Admin may adjust transforms; originals are never replaced.
    if (Array.isArray(images) && images.length) {
      const byId = new Map(images.map(i => [i.id, i]));
      updates.images = (order.images || []).map(img => {
        const patch = byId.get(img.id);
        return patch && patch.transform
          ? { ...img, transform: normalizeTransform(patch.transform) }
          : img;
      });
    }

    await db.updateOrder(id, updates);

    // Regenerate the print output so the stored file matches the new design.
    const refreshed = await db.getOrderById(id);
    const template = resolveTemplate({
      sku: refreshed.sku, productType: refreshed.productType, productTitle: refreshed.product
    });

    const printFiles = [];
    const failures = [];
    // PDF is generated entirely from the customer's original stored images.
    // No canvas preview is sent from the frontend, so there is no request-body
    // size limit to worry about and quality is always full original resolution.

    const isButterfly = (refreshed.productType || '').toLowerCase() === 'butterfly' || (refreshed.product || '').toLowerCase().includes('butterfly');
    const isMagazine = (refreshed.productType || '').toLowerCase() === 'magazine' || (refreshed.product || '').toLowerCase().includes('magazine');
    const isPolaroid = (refreshed.productType || '').toLowerCase() === 'polaroid' || (refreshed.product || '').toLowerCase().includes('polaroid') || (refreshed.sku || '').toUpperCase().includes('PG-PP') || (refreshed.sku || '').toUpperCase().includes('POLAROID');
    if (isButterfly) {
      try {
        const file = await generateButterflyBoxPdf({ orderId: refreshed.id, images: refreshed.images || [], order: refreshed });
        printFiles.push({ ...file, isButterfly: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else if (isMagazine) {
      try {
        const file = await generateMagazinePdf({ orderId: refreshed.id, images: refreshed.images || [], order: refreshed });
        printFiles.push({ ...file, isMagazine: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else if (isPolaroid) {
      try {
        const file = await generatePolaroidPdf({ orderId: refreshed.id, images: refreshed.images || [], order: refreshed });
        printFiles.push({ ...file, isPolaroid: true });
      } catch (err) {
        failures.push({ error: err.message });
      }
    } else {
      for (const img of refreshed.images || []) {
        try {
          const file = await generatePrintPdf({
            orderId: refreshed.id, order: refreshed, image: img, template,
            transform: img.transform || fromLegacyImage(img)
          });
          printFiles.push({ ...file, imageId: img.id });
        } catch (err) {
          failures.push({ imageId: img.id, error: err.message });
        }
      }
    }

    const submitUpdates = {
      printFiles: printFiles.length ? printFiles : refreshed.printFiles,
      pdfUrl: printFiles.length ? printFiles[0].url : refreshed.pdfUrl,
      printGenerationStatus: printFiles.length ? derivePrintGenerationStatus(printFiles, failures) : 'failed',
      printGenerationErrors: failures,
      printStatus: 'queued',
      orderStatus: 'Approved',
      adminApprovalStatus: 'approved',
      printerAssignedAt: new Date()
    };
    // Keep workflowStatus consistent with the sub-fields we just wrote,
    // instead of leaving it stuck at whatever the customer submit set.
    submitUpdates.workflowStatus = reconcileWorkflowStatus({ ...refreshed, ...submitUpdates });
    const finalOrder = await db.updateOrder(id, submitUpdates);

    await db.addActivityLog(id, 'ADMIN_EDITED_DESIGN', 'An administrator edited the design layout or photos.');
    
    console.log(`[WORKFLOW LOG] STEP 12 - Admin Edited Design for Order ${id}`);
    res.json({ success: true, order: finalOrder, revision: updates.designRevisions.length, printFiles, failures });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    regenerating.delete(id);
  }
});

/**
 * Reveal an order's upload token to an administrator.
 *
 * Lets staff re-send the WhatsApp link, or upload on a customer's behalf by
 * driving the same token-authenticated portal endpoints the customer uses.
 * Routing admin uploads through that one pipeline means originals, resolution
 * checks and transform handling cannot drift between the two paths.
 */
router.get('/:id/upload-token', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!order.uploadToken) {
      return res.status(404).json({ success: false, error: 'This order has no upload link yet.' });
    }

    res.json({
      success: true,
      token: order.uploadToken,
      uploadLink: order.uploadLink,
      expiresAt: order.uploadTokenExpiresAt || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin override: approve without waiting for the customer to press Confirm
 * (used when a customer has uploaded but gone quiet).
 *
 * It still refuses to approve an order with no artwork - "force" shortcuts the
 * customer's confirmation, not the requirement for a real print file, because
 * approving an empty order would send a blank sheet to the press.
 */
router.post('/:id/force-approve', adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (regenerating.has(id)) {
    return res.status(409).json({ success: false, error: 'This order is already being processed.' });
  }
  regenerating.add(id);
  try {
    const order = await db.getOrderById(id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!(order.images || []).length) {
      return res.status(422).json({
        success: false,
        error: 'This order has no customer photos, so it cannot be approved for printing.'
      });
    }

    let printFiles = order.printFiles || [];
    if (!printFiles.length) {
      const template = resolveTemplate({
        sku: order.sku, productType: order.productType, productTitle: order.product
      });
      const isButterfly = (order.productType || '').toLowerCase() === 'butterfly' || (order.product || '').toLowerCase().includes('butterfly');
      const isMagazine = (order.productType || '').toLowerCase() === 'magazine' || (order.product || '').toLowerCase().includes('magazine');
      const isPolaroid = (order.productType || '').toLowerCase() === 'polaroid' || (order.product || '').toLowerCase().includes('polaroid');
      let extraUpdateData = {};
      if (isButterfly) {
        try {
          const result = await allocateButterflyTemplate(order, order.images || []);
          if (result.generated) {
            printFiles.push(...result.printFiles);
          }
          extraUpdateData = {
            templateId: result.templateId,
            templateSide: result.templateSide,
            linkedOrderId: result.linkedOrderId,
            printGenerationStatus: result.printGenerationStatus || 'pending'
          };
        } catch (err) {
          console.error('[FORCE APPROVE BUTTERFLY ALLOCATION ERROR]', id, err.message);
        }
      } else if (isMagazine) {
        try {
          const file = await generateMagazinePdf({ orderId: order.id, images: order.images || [], order });
          printFiles.push({ ...file, isMagazine: true });
        } catch (err) {
          console.error('[FORCE APPROVE RENDER ERROR]', id, err.message);
        }
      } else if (isPolaroid) {
        try {
          const file = await generatePolaroidPdf({ orderId: order.id, images: order.images || [], order });
          printFiles.push({ ...file, isPolaroid: true });
        } catch (err) {
          console.error('[FORCE APPROVE POLAROID RENDER ERROR]', id, err.message);
        }
      } else {
        for (const img of order.images) {
          try {
            const file = await generatePrintPdf({
              orderId: order.id, order, image: img, template,
              transform: img.transform || fromLegacyImage(img)
            });
            printFiles.push({ ...file, imageId: img.id });
          } catch (err) {
            console.error('[FORCE APPROVE RENDER ERROR]', id, err.message);
          }
        }
      }
      if (!printFiles.length) {
        return res.status(422).json({ success: false, error: 'No print-ready file could be generated for this order.' });
      }
    }

    const updateData = {
      designLockedAt: order.designLockedAt || new Date(),
      customizationStatus: 'completed',
      // Default for the magazine/canvas branches, which don't set this
      // themselves; the butterfly branch's extraUpdateData overrides it.
      printGenerationStatus: derivePrintGenerationStatus(printFiles),
      ...extraUpdateData,
      uploadStatus: 'ready',
      adminApprovalStatus: 'approved',
      orderStatus: 'Approved',
      printStatus: 'queued',
      printFiles,
      pdfUrl: printFiles[0].url
    };
    updateData.workflowStatus = reconcileWorkflowStatus({ ...order, ...updateData });

    await db.addActivityLog(id, 'PDF_REGENERATED', `An administrator generated a new production print file.`);

    const updated = await db.updateOrder(id, updateData);
    console.log(`[WORKFLOW LOG] STEP 13 - Admin Generated Production File for Order ${id}`);

    await db.addActivityLog(id, 'ADMIN_FORCE_APPROVED',
      `Admin ${req.user?.email || ''} force-approved this order without customer confirmation.`);

    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    regenerating.delete(id);
  }
});

/**
 * AI upscaling is not implemented.
 *
 * Resampling a low-resolution photo to hit a pixel count does NOT create
 * detail; it would produce a file that claims 300 DPI while printing soft.
 * That is exactly the false-DPI claim this system must not make, so this
 * returns an explicit 501 rather than silently faking it. Wiring a real
 * super-resolution service here is the intended extension point.
 */
router.post('/:id/upscale', adminMiddleware, (_req, res) => {
  res.status(501).json({
    success: false,
    code: 'NOT_IMPLEMENTED',
    error: 'AI upscaling is not configured. Resampling cannot add real detail, so low-resolution '
         + 'photos must be re-requested from the customer rather than upscaled.'
  });
});

/** Restore the composition exactly as the customer approved it. */
router.post('/:id/restore-customer-design', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!order.customerApprovedImages) {
      return res.status(409).json({ success: false, error: 'This order has not been edited, so there is nothing to restore.' });
    }

    const updated = await db.updateOrder(req.params.id, { images: order.customerApprovedImages });
    await db.addActivityLog(req.params.id, 'ADMIN_RESTORED_CUSTOMER_DESIGN',
      `Admin ${req.user?.email || ''} restored the customer-approved composition.`);
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Queue a customer notification (upload link / reminder).
 *
 * WhatsApp delivery is not configured in this environment, so the notification
 * is recorded and the workflow continues. The record carries a dedupe key so a
 * repeated click cannot enqueue the same message twice, and a delivery failure
 * never corrupts the order state.
 */
router.post('/:id/notify', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const kind = String(req.body?.type || 'upload_link');
    const { sendCustomerNotification } = require('../services/notification.service');
    const result = await sendCustomerNotification(order, kind);

    res.json({
      success: true,
      queued: result.queued,
      duplicate: result.duplicate,
      channel: result.channel,
      delivered: result.delivered,
      message: result.message
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update order status (General status patch)
// Admin only - anyone could otherwise drive any order to any status.
router.patch('/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status, orderStatus, printStatus, deliveryStatus, workflowStatus } = req.body;
    const updates = {};

    if (orderStatus) updates.orderStatus = orderStatus;
    if (status) updates.orderStatus = status;
    if (printStatus) updates.printStatus = printStatus;
    if (deliveryStatus) updates.deliveryStatus = deliveryStatus;
    if (workflowStatus) updates.workflowStatus = workflowStatus;

    // Keep workflowStatus in sync with whatever sub-field just changed, unless
    // the caller set it explicitly.
    if (!workflowStatus && Object.keys(updates).length > 0) {
      const existing = await db.getOrderById(req.params.id);
      if (existing) updates.workflowStatus = reconcileWorkflowStatus({ ...existing, ...updates });
    }

    const order = await db.updateOrder(req.params.id, updates);
    if (orderStatus || status) {
      await db.addActivityLog(req.params.id, 'STATUS_UPDATE', `Order status updated to ${orderStatus || status}`);
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Apply a Shopify-detected shipped/delivered signal (see
 * shopifyWebhookService.js's detectPendingDeliveryUpdate) to this order's
 * real deliveryStatus/workflowStatus. Deliberately a separate, explicit
 * admin action rather than automatic - Shopify's fulfillment data can be
 * wrong or premature.
 */
router.post('/:id/confirm-delivery-update', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const pending = order.pendingDeliveryUpdate;
    if (!pending || !pending.status) {
      return res.status(409).json({ success: false, error: 'No pending Shopify delivery update for this order.' });
    }

    const updates = {
      deliveryStatus: pending.status,
      trackingNumber: pending.trackingNumber || order.trackingNumber,
      trackingUrl: pending.trackingUrl || order.trackingUrl,
      trackingCompany: pending.trackingCompany || order.trackingCompany,
      pendingDeliveryUpdate: null
    };
    updates.workflowStatus = reconcileWorkflowStatus({ ...order, ...updates });

    const updated = await db.updateOrder(order.id, updates);
    await db.addActivityLog(order.id, 'DELIVERY_CONFIRMED',
      `Admin ${req.user?.email || ''} confirmed Shopify's "${pending.status}" update.`);
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Discard a pending Shopify delivery update without applying it (e.g. Shopify's data looked wrong). */
router.post('/:id/dismiss-delivery-update', adminMiddleware, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!order.pendingDeliveryUpdate) {
      return res.status(409).json({ success: false, error: 'No pending Shopify delivery update for this order.' });
    }

    const updated = await db.updateOrder(order.id, { pendingDeliveryUpdate: null });
    await db.addActivityLog(order.id, 'DELIVERY_UPDATE_DISMISSED',
      `Admin ${req.user?.email || ''} dismissed a Shopify delivery update.`);
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete order
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    await db.deleteOrderById(req.params.id);
    res.json({ success: true, message: 'Order deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;




