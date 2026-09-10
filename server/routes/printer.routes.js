const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth.middleware');

/**
 * Printer dashboard API.
 *
 * Every route requires a printer (or admin) role. Authorisation is enforced
 * here, server-side - hiding buttons in the UI is not a control.
 *
 * A printer may only move a job through production states. Artwork, design
 * transforms, images and print files are NOT writable from these endpoints,
 * so a printer cannot alter what the customer approved.
 */
const printerAuth = authMiddleware(['printer', 'admin']);

/**
 * Production statuses a printer is permitted to set, and their side effects.
 *
 * Two vocabularies are accepted deliberately: the specification's production
 * stages (assigned/printing/printed/packed/shipped/completed) and the shorter
 * set the existing printer UI already emits (pending/processing/print-ready).
 * They map onto the same underlying states, so the dashboard keeps working
 * without a lockstep frontend deploy.
 */
const ALLOWED_TRANSITIONS = {
  // 4 Simplified Production Workflow Stages:
  // Pending -> Print Ready -> Printing -> Completed
  pending:             { printStatus: 'pending',     orderStatus: 'Pending',              workflowStatus: 'photo_uploaded' },
  'print-ready':       { printStatus: 'queued',      orderStatus: 'Print Ready',          workflowStatus: 'approved' },
  ready:               { printStatus: 'queued',      orderStatus: 'Print Ready',          workflowStatus: 'approved' },

  printing:            { printStatus: 'processing',  orderStatus: 'Printing',             workflowStatus: 'printing' },
  processing:          { printStatus: 'processing',  orderStatus: 'Printing',             workflowStatus: 'printing' },
  assigned:            { printStatus: 'processing',  orderStatus: 'Printing',             workflowStatus: 'printing' },
  printed:             { printStatus: 'processing',  orderStatus: 'Printing',             workflowStatus: 'printing' },

  completed:           { printStatus: 'completed',   orderStatus: 'Delivered',          deliveryStatus: 'delivered', workflowStatus: 'delivered' },
  ready_for_dispatch:  { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  packed:              { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  in_transit:          { printStatus: 'completed',   orderStatus: 'In Transit',         deliveryStatus: 'shipped',   workflowStatus: 'in_transit' },
  shipped:             { printStatus: 'completed',   orderStatus: 'In Transit',         deliveryStatus: 'shipped',   workflowStatus: 'in_transit' },
  delivered:           { printStatus: 'completed',   orderStatus: 'Delivered',          deliveryStatus: 'delivered', workflowStatus: 'delivered' },
  done:                { printStatus: 'completed',   orderStatus: 'Delivered',          deliveryStatus: 'delivered', workflowStatus: 'delivered' }
};

const STAGE_ORDER = ['pending', 'queued', 'processing', 'completed'];

// deriveDashStatus (order -> 'pending'|'print-ready'|'processing'|'completed')
// lives in server/utils/orderStatus.js so the admin app, the printer app and
// any migration all agree on what "Print Ready" means. It requires a
// genuinely approved + rendered job, not just printStatus:'queued'.
const { deriveDashStatus } = require('../utils/orderStatus');

function serializeQueueItem(o) {
  const filesArray = Array.isArray(o.printFiles) ? o.printFiles : [];
  const file = filesArray.filter(Boolean)[0];
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer?.name || o.customer?.email || (typeof o.customer === 'string' ? o.customer : 'Guest'),
    customerEmail: o.customerEmail || o.email || o.customer?.email,
    phone: o.phone || o.customer?.phone,
    product: o.product,
    sku: o.sku,
    quantity: o.quantity,
    templateId: o.templateId,
    status: deriveDashStatus(o),
    printStatus: o.printStatus,
    workflowStatus: o.workflowStatus,
    orderStatus: o.orderStatus,
    priority: o.priority || 'normal',
    pdfUrl: o.pdfUrl,
    shippingAddress: o.shippingAddress,
    deliveryTemplate: o.deliveryTemplate,
    customizationStatus: o.customizationStatus,
    uploadStatus: o.uploadStatus,
    trimSize: (file && file.widthMm && file.heightMm) ? `${Math.round(file.widthMm)}x${Math.round(file.heightMm)}mm` : '-',
    assignedAt: o.printerAssignedAt || o.updatedAt,
    printFiles: filesArray.filter(Boolean).map(f => ({
      url: f.url, dpi: f.dpi, effectiveDpi: f.effectiveDpi,
      widthMm: f.widthMm, heightMm: f.heightMm, colourSpace: f.colourSpace
    })),
    updatedAt: o.updatedAt
  };
}

/**
 * Only approved/sent work reaches the print floor, or all orders for printer
 * inspection.
 *
 * `status` and `search` can't be expressed as a plain Mongo filter - status
 * is derived from a combination of two fields (see deriveDashStatus), not
 * stored directly. So this runs as two passes: a cheap scan across every
 * order using only the handful of small fields needed to match status/search
 * (never the heavy ones - images, shippingAddress, printFiles, etc.), then a
 * second query that fetches full order data for only the current page's
 * worth of matches. The full documents for orders outside the current page
 * are never touched.
 */
router.get('/queue', printerAuth, async (req, res) => {
  try {
    const Order = require('../models/Order');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const status = req.query.status || '';
    const search = (req.query.search || '').trim().toLowerCase();

    const lightProjection = {
      _id: 0, id: 1, orderNumber: 1, printStatus: 1, workflowStatus: 1,
      adminApprovalStatus: 1, printGenerationStatus: 1, deliveryStatus: 1,
      product: 1, sku: 1, createdAt: 1,
      'customer.name': 1, 'customer.email': 1
    };
    const light = await Order.find({}, lightProjection).sort({ createdAt: -1 }).lean();

    const tabCounts = { all: light.length, pending: 0, 'print-ready': 0, processing: 0, completed: 0 };
    const matches = [];
    for (const o of light) {
      const dashStatus = deriveDashStatus(o);
      if (tabCounts[dashStatus] !== undefined) tabCounts[dashStatus]++;

      if (status && status !== 'all' && dashStatus !== status) continue;
      if (search) {
        const haystack = [o.id, o.orderNumber, o.customer?.name, o.customer?.email, o.product, o.sku]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      matches.push(o.id);
    }

    const total = matches.length;
    const pageIds = matches.slice((page - 1) * limit, (page - 1) * limit + limit);

    // Lightweight projection for the heavy fetch: excludes fields the queue
    // view never renders (images, designData, etc. - see serializeQueueItem).
    const queueProjection = {
      designData: 0, designRevisions: 0, printGenerationErrors: 0,
      activityLogs: 0, customerApprovedImages: 0, images: 0
    };
    const pageOrders = await Order.find({ id: { $in: pageIds } }, queueProjection).lean();
    const byId = new Map(pageOrders.map(o => [o.id, o]));
    const queue = pageIds.map(id => byId.get(id)).filter(Boolean).map(serializeQueueItem);

    res.json({
      success: true,
      queue,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      tabCounts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/queue/:id', printerAuth, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const inPrinterWorkflow = ['sent_to_printer', 'printer_processing', 'completed'].includes(order.workflowStatus);
    if (order.adminApprovalStatus !== 'approved' && !inPrinterWorkflow) {
      return res.status(403).json({ success: false, error: 'This order has not been approved for printing yet.' });
    }

    // AUTO-TRIGGER: When the printer opens/views the order, advance status to printer_processing
    if (order.workflowStatus === 'sent_to_printer') {
      await db.updateOrder(order.id, { workflowStatus: 'printer_processing', printStatus: 'processing', orderStatus: 'Printing' });
      await db.addActivityLog(order.id, 'PRINTER_VIEWED', `Printer ${req.user?.email || 'unknown'} opened the order — status advanced to Printer Processing.`);
      console.log(`[WORKFLOW LOG] Order ${order.id} auto-advanced to printer_processing upon view.`);
      // Return the freshest copy
      const updated = await db.getOrderById(order.id);
      return res.json({ success: true, order: updated });
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Hand the printer the generated print file. Returns a URL rather than piping
 * the bytes so the browser can stream it directly from static hosting/CDN.
 * The file must already exist on disk - this endpoint never invents a path.
 */
router.get('/download/:id', printerAuth, async (req, res) => {
  try {
    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const inPrinterWorkflow2 = ['sent_to_printer', 'printer_processing', 'completed'].includes(order.workflowStatus);
    if (order.adminApprovalStatus !== 'approved' && !inPrinterWorkflow2) {
      return res.status(403).json({ success: false, error: 'This order has not been approved for printing yet.' });
    }
    // AUTO-TRIGGER: Downloading the file means the printer is actively processing it
    if (order.workflowStatus === 'sent_to_printer') {
      await db.updateOrder(order.id, { workflowStatus: 'printer_processing', printStatus: 'processing', orderStatus: 'Printing' });
      await db.addActivityLog(order.id, 'PRINTER_DOWNLOADED', `Printer ${req.user?.email || 'unknown'} downloaded print file — status advanced to Printer Processing.`);
      console.log(`[WORKFLOW LOG] Order ${order.id} auto-advanced to printer_processing upon download.`);
    }

    const { resolveTemplate } = require('../config/printTemplates');
    const { fromLegacyImage } = require('../utils/designTransform');
    const { generatePrintPdf } = require('../utils/printRenderer');
    const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
    const { generateMagazinePdf } = require('../utils/magazineGenerator');
    const os = require('os');
    const isVercel = process.env.VERCEL === '1';

    let file = (order.printFiles || [])[0];
    let needsGeneration = !file || !file.url;
    let onDisk = null;

    if (file && file.url) {
      onDisk = path.join(__dirname, '..', file.url.replace(/^\//, ''));
      if (isVercel) {
        onDisk = path.join(os.tmpdir(), path.basename(file.url));
      }
      if (!fs.existsSync(onDisk)) {
        // The local copy is gone (server restart/redeploy/different
        // serverless instance - the common case, not the exception, since
        // S3 is the only persistent store for generated print files). Try
        // restoring the existing file from S3 before falling back to
        // regenerating it from scratch.
        try {
          const { existsInS3, restoreFromS3 } = require('../utils/s3Storage');
          const s3Key = `print/${path.basename(file.url)}`;
          if (await existsInS3(s3Key)) {
            await restoreFromS3(s3Key, onDisk);
          }
        } catch (restoreErr) {
          console.warn(`[PRINTER DOWNLOAD] S3 restore attempt failed for order ${order.id}:`, restoreErr.message);
        }
        if (!fs.existsSync(onDisk)) {
          needsGeneration = true;
        }
      }
    }

    if (needsGeneration) {
      try {
        console.log(`[PRINTER DOWNLOAD] Print file missing or record incomplete for order ${order.id}. Generating on-the-fly...`);
        const template = resolveTemplate({
          sku: order.sku, productType: order.productType, productTitle: order.product
        });

        const isButterfly = (order.productType || '').toLowerCase() === 'butterfly' || (order.product || '').toLowerCase().includes('butterfly');
        const isMagazine = (order.productType || '').toLowerCase() === 'magazine' || (order.product || '').toLowerCase().includes('magazine');

        let generatedFile = null;

        if (isButterfly) {
          generatedFile = await generateButterflyBoxPdf({ orderId: order.id, images: order.images || [], order });
        } else if (isMagazine) {
          generatedFile = await generateMagazinePdf({ orderId: order.id, images: order.images || [], order });
        } else {
          const img = (order.images || [])[0];
          if (img) {
            generatedFile = await generatePrintPdf({
              orderId: order.id, order, image: img, template,
              transform: img.transform || fromLegacyImage(img)
            });
          }
        }

        if (generatedFile && generatedFile.path) {
          const newFile = {
            url: generatedFile.url || `/uploads/print/${generatedFile.filename}`,
            filename: generatedFile.filename,
            widthMm: generatedFile.widthMm,
            heightMm: generatedFile.heightMm,
            dpi: generatedFile.dpi,
            colourSpace: generatedFile.colourSpace || 'RGB',
            effectiveDpi: generatedFile.effectiveDpi
          };

          // The generator already persisted the file to S3 (its sole
          // durable store) and deletes its own local scratch copy once
          // that upload succeeds - so generatedFile.path is frequently
          // already gone by the time we get here. Renaming into the old
          // `onDisk` slot only works if that scratch file still exists;
          // otherwise just point the order at the newly generated file's
          // own filename/URL instead of forcing it into the stale one.
          if (file && file.url && generatedFile.path !== onDisk && fs.existsSync(generatedFile.path)) {
            fs.renameSync(generatedFile.path, onDisk);
          } else {
            file = newFile;
            await db.updateOrder(order.id, {
              printFiles: [file],
              pdfUrl: file.url,
              printStatus: 'processing',
              printGenerationStatus: 'success'
            });
          }
          console.log(`[PRINTER DOWNLOAD] Successfully generated and saved print file.`);
        } else {
          throw new Error('No template or images found to generate print file.');
        }
      } catch (genErr) {
        console.error('[PRINTER DOWNLOAD] On-the-fly print file generation failed:', genErr);
        return res.status(404).json({
          success: false,
          error: 'No print-ready file exists and dynamic generation failed: ' + genErr.message
        });
      }
    }

    await db.addActivityLog(order.id, 'PRINT_FILE_DOWNLOADED',
      `Printer ${req.user?.email || 'unknown'} downloaded the print file.`);
      
    console.log(`[WORKFLOW LOG] STEP 14 - Printer Downloaded Production File for Order ${order.id}`);

    res.json({
      success: true,
      url: file.url,
      filename: file.filename || path.basename(file.url),
      dpi: file.dpi,
      effectiveDpi: file.effectiveDpi,
      widthMm: file.widthMm,
      heightMm: file.heightMm,
      colourSpace: file.colourSpace || 'RGB'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Batch Download endpoint for Production/Printer team.
 * Allows selecting multiple orders and receiving a ZIP archive containing files
 * organized by Order/SKU with standard naming convention:
 * OrderNumber_SKU_PhotoNumber.ext (e.g. 184347_PG-PM-01_01.jpg)
 */
async function handleBatchDownload(req, res) {
  try {
    const rawIds = req.body?.orderIds || (req.query?.orderIds ? String(req.query.orderIds).split(',') : []);
    const orderIds = Array.isArray(rawIds) ? rawIds.filter(Boolean) : [];

    if (orderIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Please select at least one order to download.' });
    }

    const SimpleZip = require('../utils/simpleZip');
    const zip = new SimpleZip();
    const Order = require('../models/Order');

    const formattedNumbers = orderIds.map(i => i.startsWith('#') ? i : `#${i}`);
    const rawNumbers = orderIds.map(i => i.replace(/^#/, ''));
    const numericIds = orderIds.map(i => Number(i)).filter(n => !isNaN(n));

    const orders = await Order.find({
      $or: [
        { id: { $in: orderIds } },
        { id: { $in: numericIds } },
        { id: { $in: rawNumbers } },
        { orderNumber: { $in: orderIds } },
        { orderNumber: { $in: formattedNumbers } },
        { orderNumber: { $in: rawNumbers } }
      ]
    }).lean();
    if (!orders || orders.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching orders found for batch download.' });
    }

    let addedFileCount = 0;

    for (const order of orders) {
      const orderNum = String(order.orderNumber || order.id || 'ORDER').replace(/#/g, '').trim();
      const skuRaw = String(order.sku || order.product || 'CUSTOM').replace(/[^a-zA-Z0-9-_]/g, '_').trim();
      const folderName = `Order_${orderNum}_${skuRaw}`;

      // 1. Process customer uploaded photos
      const images = (order.images || []).filter(img => img && img.url);
      images.forEach((img, idx) => {
        const photoNum = String(idx + 1).padStart(2, '0');
        const ext = path.extname(img.url.split('?')[0]) || '.jpg';
        const fileName = `${orderNum}_${skuRaw}_${photoNum}${ext}`;
        const relativePath = img.url.replace(/^\//, '');
        const fullPath = path.join(__dirname, '..', relativePath);

        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          zip.addFile(`${folderName}/${fileName}`, content);
          addedFileCount++;
        }
      });

      // 2. Process generated print files / PDFs
      const printFiles = (order.printFiles || []).filter(f => f && f.url);
      printFiles.forEach((file, idx) => {
        const ext = path.extname(file.url.split('?')[0]) || '.pdf';
        const fileName = `${orderNum}_${skuRaw}_PrintFile_${String(idx + 1).padStart(2, '0')}${ext}`;
        const relativePath = file.url.replace(/^\//, '');
        const fullPath = path.join(__dirname, '..', relativePath);

        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          zip.addFile(`${folderName}/${fileName}`, content);
          addedFileCount++;
        }
      });

      // Advance order status to Printing if currently Pending or Print Ready
      if (['sent_to_printer', 'queued', 'pending'].includes(order.workflowStatus) || ['pending', 'queued'].includes(order.printStatus)) {
        await db.updateOrder(order.id, {
          workflowStatus: 'printing',
          printStatus: 'processing',
          orderStatus: 'Printing'
        });
      }
      await db.addActivityLog(order.id, 'BATCH_DOWNLOAD', `Printer ${req.user?.email || 'unknown'} batch downloaded files for Order #${orderNum}.`);
    }

    if (addedFileCount === 0) {
      return res.status(404).json({ success: false, error: 'No physical image or PDF files found on disk for selected orders.' });
    }

    const zipBuffer = zip.toBuffer();
    const zipName = `Batch_Print_Jobs_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.send(zipBuffer);
  } catch (err) {
    console.error('[BATCH DOWNLOAD ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

router.post('/batch-download', printerAuth, handleBatchDownload);
router.get('/batch-download', printerAuth, handleBatchDownload);

const handleStatusUpdate = async (req, res) => {
  try {
    const requested = String(req.body?.status || '').toLowerCase();
    const transition = ALLOWED_TRANSITIONS[requested];

    if (!transition) {
      return res.status(400).json({
        success: false,
        error: `Invalid production status "${requested}".`,
        allowed: Object.keys(ALLOWED_TRANSITIONS)
      });
    }

    const order = await db.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const currentIndex = STAGE_ORDER.indexOf(order.printStatus || 'pending');
    const targetIndex = STAGE_ORDER.indexOf(transition.printStatus);

    if (targetIndex !== -1 && currentIndex !== -1) {
      if (targetIndex > currentIndex + 1) {
        return res.status(409).json({
          success: false,
          code: 'INVALID_TRANSITION',
          error: `Cannot skip production stages from ${order.printStatus} to ${transition.printStatus}.`
        });
      }
    }

    const isApprovedOrUploaded = order.adminApprovalStatus === 'approved' || order.workflowStatus === 'photo_uploaded' || order.workflowStatus === 'approved' || order.workflowStatus === 'printing' || order.workflowStatus === 'ready_for_dispatch' || order.workflowStatus === 'in_transit' || order.workflowStatus === 'delivered' || order.requiresCustomization === false || order.customizationStatus === 'completed' || order.uploadStatus === 'ready';
    if (!isApprovedOrUploaded) {
      return res.status(403).json({ success: false, error: 'This order has not been approved for printing yet.' });
    }

    // Whitelisted fields only - the request body can never reach artwork fields.
    const updated = await db.updateOrder(req.params.id, { ...transition });
    await db.addActivityLog(
      req.params.id,
      'PRINTER_STATUS_UPDATE',
      `Printer ${req.user?.email || req.user?.id || 'unknown'} set production status to ${requested}.`
    );
      
    console.log(`[WORKFLOW LOG] STEP 15 - Printer Updated Status to '${requested}' for Order ${req.params.id}`);

    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/queue/:id/status', printerAuth, handleStatusUpdate);
router.post('/jobs/:id/status', printerAuth, handleStatusUpdate);
router.patch('/jobs/:id/status', printerAuth, handleStatusUpdate);
router.patch('/queue/:id/status', printerAuth, handleStatusUpdate);

/**
 * Explicit rejection of artwork edits by the printer role. A missing route
 * would already 404, but an explicit 403 documents the rule and makes the
 * guarantee directly testable.
 */
router.all('/queue/:id/design', printerAuth, (_req, res) => {
  res.status(403).json({ success: false, error: 'Printers cannot modify customer artwork.' });
});

module.exports = router;
module.exports.ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
