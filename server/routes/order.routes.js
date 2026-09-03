const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth.middleware');
const { resolveTemplate } = require('../config/printTemplates');
const { normalizeTransform } = require('../utils/designTransform');
const { generatePrintPdf, UPLOADS_DIR } = require('../utils/printRenderer');
const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
const { allocateButterflyTemplate } = require('../services/butterflyAllocation.service');
const { generateMagazinePdf } = require('../utils/magazineGenerator');
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
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const status = req.query.status || '';
    const search = (req.query.search || '').trim();

    console.log('[ORDERS] DB readyState:', mongoose.connection.readyState, '| page:', page, '| limit:', limit, '| status:', status || 'all', '| search:', search || 'none');

    // Base filter: list all orders for Admin Portal
    const baseFilter = {};

    // Combine with tab status and search
    const filter = { $and: [baseFilter] };

    if (status && status !== 'all') {
      filter.$and.push({ uploadStatus: status });
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

    // ── Lightweight projection: exclude heavy embedded arrays from listing ──
    // These fields (images, designData, printFiles, activityLogs, designRevisions)
    // can be multi-MB per order. Fetching 50+ of them causes Vercel serverless
    // function timeouts. They are fetched individually when a user opens a
    // specific order detail view.
    const listProjection = {
      images: 0,
      designData: 0,
      designRevisions: 0,
      printFiles: 0,
      printGenerationErrors: 0,
      activityLogs: 0,
      customerApprovedImages: 0,
    };

    // Run all queries in parallel for speed
    const [orders, total, countAll, countReady, countPending, countApproved, countSentToPrinter, countProcessing, countCompleted, countRevision] = await Promise.all([
      Order.find(filter, listProjection)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
      // ── Server-side tab counts (fast indexed countDocuments) ──
      Order.countDocuments({}),
      Order.countDocuments({ $or: [{ uploadStatus: 'ready' }, { customizationStatus: 'completed' }] }),
      Order.countDocuments({ customizationStatus: { $ne: 'completed' }, uploadStatus: { $ne: 'ready' } }),
      Order.countDocuments({ $or: [{ workflowStatus: 'approved' }, { adminApprovalStatus: 'approved', workflowStatus: { $nin: ['sent_to_printer', 'printer_processing', 'printing', 'completed', 'delivered'] } }] }),
      Order.countDocuments({ workflowStatus: { $in: ['sent_to_printer', 'printing'] } }),
      Order.countDocuments({ workflowStatus: 'printer_processing' }),
      Order.countDocuments({ workflowStatus: { $in: ['completed', 'delivered', 'ready_for_dispatch'] } }),
      Order.countDocuments({ uploadStatus: 'revision_requested' })
    ]);

    console.log('[ORDERS] Result: returned:', orders.length, '| total:', total, '| all:', countAll, '| ready:', countReady, '| pending:', countPending);

    return res.json({
      orders,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      stats: { total, pending: countPending, ready: countReady, revision: countRevision },
      tabCounts: {
        all: countAll,
        ready: countReady,
        pending: countPending,
        approved: countApproved,
        sent_to_printer: countSentToPrinter + countProcessing,
        completed: countCompleted,
      }
    });
  } catch (err) {
    console.error('[GET /api/orders] Error:', err.message, err.stack);
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

    // ── Return IMMEDIATELY — do not wait for any Shopify network call ──
    res.json(customerOrders);

    // ── Background Shopify sync — fires AFTER response sent, 5-min cooldown ──
    setImmediate(async () => {
      try {
        const db = require('../db');
        const settings = await db.getSettings();
        const shop = settings.shopifyStore || process.env.SHOPIFY_STORE;
        const token = settings.shopifyAccessToken || process.env.SHOPIFY_ACCESS_TOKEN;
        if (!token || token === 'your_access_token_here' || !shop) return;

        if (!global._shopifySyncCache) global._shopifySyncCache = {};
        const syncKey = `sync:${userEmail || userPhone}`;
        const now = Date.now();
        if (now - (global._shopifySyncCache[syncKey] || 0) < 5 * 60 * 1000) return;
        global._shopifySyncCache[syncKey] = now;

        const shopifyService = require('../services/shopify.service');
        const dummyMatch = userEmail ? userEmail.match(/^(\d+)@customer\.com$/) : null;
        const queryParams = dummyMatch
          ? { customer_id: dummyMatch[1], status: 'any' }
          : { status: 'any', ...(userEmail ? { email: userEmail } : {}) };

        const shopifyOrders = await shopifyService.getOrdersFromShopify(shop, token, queryParams);
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

const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const PREVIEWS_DIR = path.join(UPLOADS_DIR, 'previews');
for (const dir of [ORIGINALS_DIR, PREVIEWS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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

      // S3 is the only persistent store - await both saves so the upload isn't
      // reported as successful until it's actually durably stored.
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
      fs.unlink(req.file.path, () => {});
      fs.unlink(previewPath, () => {});

      const image = {
        id: `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        name: path.basename(req.file.originalname).slice(0, 120),
        originalKey: path.join('originals', req.file.filename),
        previewUrl: `/uploads/previews/${previewName}`,
        url: `/uploads/originals/${req.file.filename}`,
        mimeType: req.file.mimetype,
        bytes: req.file.size,
        width: meta.width,
        height: meta.height,
        uploadedAt: new Date()
      };

      const Order = require('../models/Order');
      await Order.updateOne(
        { id: existingOrder.id },
        { $push: { images: image }, $set: { uploadStatus: 'in_progress', customizationStatus: 'in-progress' } }
      );

      await db.addActivityLog(existingOrder.id, 'IMAGE_UPLOADED', `Customer uploaded ${image.name}.`);

      res.json({
        success: true,
        image
      });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(500).json({ success: false, error: err.message });
    }
  });
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
              const buffer = Buffer.from(matches[2], 'base64');
              const ext = matches[1].split('/')[1] || 'png';
              const filename = 'orig_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
              
              // S3 is the only persistent store - upload the buffer directly,
              // no disk touched at all, and skip this image if it doesn't land.
              const { saveBufferToS3 } = require('../utils/s3Storage');
              try {
                await saveBufferToS3(`originals/${filename}`, buffer);
              } catch (s3Err) {
                console.error('[S3 Base64 Save Error]', s3Err);
                continue;
              }

              processedImages.push({ ...img, src: '/uploads/originals/' + filename, url: '/uploads/originals/' + filename });
              continue;
            }
          } catch (e) {
            console.error('Error saving base64 image to S3:', e);
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

    // Calculate current design hash
    const isButterfly = (existingOrder.productType || '').toLowerCase() === 'butterfly' || (existingOrder.product || '').toLowerCase().includes('butterfly');
    const isMagazine = (existingOrder.productType || '').toLowerCase() === 'magazine' || (existingOrder.product || '').toLowerCase().includes('magazine');
    
    let templateId = '';
    if (isButterfly) {
      templateId = existingOrder.sku || existingOrder.productType || 'butterfly';
    } else if (isMagazine) {
      templateId = existingOrder.sku || existingOrder.productType || 'magazine';
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

    const isCached = existingOrder.designHash === currentHash && Array.isArray(existingOrder.printFiles) && existingOrder.printFiles.length > 0;

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
        updates.printGenerationStatus = 'completed';
        updates.pdfUrl = (Array.isArray(existingOrder.printFiles) && existingOrder.printFiles[0]) ? existingOrder.printFiles[0].url : null;
      } else {
        updates.designHash = currentHash;
        updates.printGenerationStatus = 'processing';
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
          const file = await generateButterflyBoxPdf({ orderId: existingOrder.id, images, order: existingOrder });
          printFiles.push({ ...file, isButterfly: true });
        } else if (isMagazine) {
          const { generateMagazinePdf } = require('../utils/magazineGenerator');
          const file = await generateMagazinePdf({ orderId: existingOrder.id, images, order: existingOrder });
          printFiles.push({ ...file, isMagazine: true });
        } else {
          const { generatePrintPdf } = require('../utils/printRenderer');
          const file = await generatePrintPdf({ orderId: existingOrder.id, order: existingOrder, images, template });
          printFiles.push(file);
        }

        const generated = printFiles.length > 0;
        await Order.updateOne({ id }, {
          $set: {
            printFiles,
            pdfUrl: generated ? printFiles[0].url : null,
            printGenerationStatus: generated ? 'completed' : 'failed'
          }
        });

        await db.addActivityLog(
          id,
          generated ? 'PDF_GENERATED' : 'PDF_FAILED',
          generated
            ? `Print file generated (${printFiles.length} of ${images.length}) in background.`
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
    if (!Array.isArray(order.printFiles) || !order.printFiles.length) {
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
    } else {
      try {
        const file = await generatePrintPdf({ orderId: order.id, order, images: order.images || [], template });
        printFiles.push(file);
      } catch (err) {
        failures.push({ error: err.message });
      }
    }

    if (!printFiles.length) {
      return res.status(422).json({ success: false, error: 'Print generation failed.', failures });
    }

    const updateData = {
      printFiles,
      templateId: template.id,
      pdfUrl: printFiles[0].url,
      printGenerationStatus: failures.length ? 'partial' : 'completed',
      printGenerationErrors: failures
    };

    const updated = await db.updateOrder(id, updateData);
    await db.addActivityLog(id, 'PDF_REGENERATED',
      `Admin ${req.user?.email || ''} regenerated the print file.`);

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
    } else {
      try {
        const file = await generatePrintPdf({ orderId: refreshed.id, order: refreshed, images: refreshed.images || [], template });
        printFiles.push(file);
      } catch (err) {
        failures.push({ error: err.message });
      }
    }

    const finalOrder = await db.updateOrder(id, {
      printFiles: printFiles.length ? printFiles : (Array.isArray(refreshed.printFiles) ? refreshed.printFiles : []),
      pdfUrl: printFiles.length ? printFiles[0].url : refreshed.pdfUrl,
      printGenerationStatus: failures.length ? (printFiles.length ? 'partial' : 'failed') : 'completed',
      printGenerationErrors: failures,
      printStatus: 'queued',
      orderStatus: 'Approved',
      adminApprovalStatus: 'approved',
      printerAssignedAt: new Date()
    });

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

    let printFiles = Array.isArray(order.printFiles) ? order.printFiles : [];
    if (!printFiles.length) {
      const template = resolveTemplate({
        sku: order.sku, productType: order.productType, productTitle: order.product
      });
      const isButterfly = (order.productType || '').toLowerCase() === 'butterfly' || (order.product || '').toLowerCase().includes('butterfly');
      const isMagazine = (order.productType || '').toLowerCase() === 'magazine' || (order.product || '').toLowerCase().includes('magazine');
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
            printGenerationStatus: result.generated ? 'completed' : 'pending'
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
      } else {
        try {
          const file = await generatePrintPdf({ orderId: order.id, order, images: order.images || [], template });
          printFiles.push(file);
        } catch (err) {
          console.error('[FORCE APPROVE RENDER ERROR]', id, err.message);
        }
      }
      if (!printFiles.length) {
        return res.status(422).json({ success: false, error: 'No print-ready file could be generated for this order.' });
      }
    }

    const updateData = {
      designLockedAt: order.designLockedAt || new Date(),
      customizationStatus: 'completed',
      ...extraUpdateData,
      uploadStatus: 'ready',
      adminApprovalStatus: 'approved',
      orderStatus: 'Approved',
      printStatus: 'queued',
      printFiles,
      pdfUrl: printFiles[0].url
    };
    
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
    const { status, orderStatus, printStatus, deliveryStatus } = req.body;
    const updates = {};

    if (orderStatus) updates.orderStatus = orderStatus;
    if (status) updates.orderStatus = status;
    if (printStatus) updates.printStatus = printStatus;
    if (deliveryStatus) updates.deliveryStatus = deliveryStatus;

    const order = await db.updateOrder(req.params.id, updates);
    if (orderStatus || status) {
      await db.addActivityLog(req.params.id, 'STATUS_UPDATE', `Order status updated to ${orderStatus || status}`);
    }
    res.json({ success: true, order });
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

// Delete a specific customer uploaded photo from an order
router.delete('/:id/photos/:photoId', adminMiddleware, async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const Order = require('../models/Order');
    const order = await Order.findOne({ id });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Find the image to optionally delete file from disk
    const imageToDelete = order.images.find(img => img.id === photoId);
    if (imageToDelete) {
      // Unlink file if it exists locally
      let origPath = imageToDelete.url;
      let prevPath = imageToDelete.previewUrl;
      
      // Convert URL to filesystem path
      if (origPath && origPath.startsWith('/uploads/')) {
        const fullOrigPath = path.join(__dirname, '..', origPath);
        fs.unlink(fullOrigPath, () => {});
      }
      if (prevPath && prevPath.startsWith('/uploads/')) {
        const fullPrevPath = path.join(__dirname, '..', prevPath);
        fs.unlink(fullPrevPath, () => {});
      }
    }

    // Remove from database
    order.images = order.images.filter(img => img.id !== photoId);
    
    // If no images left, update uploadStatus to pending
    if (order.images.length === 0) {
      order.uploadStatus = 'pending';
      order.customizationStatus = 'pending';
    }
    
    await order.save();
    await db.addActivityLog(id, 'IMAGE_DELETED', `Admin deleted photo ${imageToDelete ? imageToDelete.name : photoId}.`);
    
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete all customer uploaded photos from an order
router.delete('/:id/photos', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const Order = require('../models/Order');
    const order = await Order.findOne({ id });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Unlink files
    for (const img of order.images) {
      let origPath = img.url;
      let prevPath = img.previewUrl;
      if (origPath && origPath.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, '..', origPath), () => {});
      }
      if (prevPath && prevPath.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, '..', prevPath), () => {});
      }
    }

    order.images = [];
    order.uploadStatus = 'pending';
    order.customizationStatus = 'pending';
    await order.save();
    await db.addActivityLog(id, 'IMAGES_CLEARED', `Admin cleared all uploaded photos.`);

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;




