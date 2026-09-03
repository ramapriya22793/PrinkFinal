const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

  completed:           { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  printed:             { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  ready_for_dispatch:  { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  packed:              { printStatus: 'completed',   orderStatus: 'Ready for Dispatch',   workflowStatus: 'ready_for_dispatch' },
  in_transit:          { printStatus: 'completed',   orderStatus: 'In Transit',         deliveryStatus: 'shipped',   workflowStatus: 'in_transit' },
  shipped:             { printStatus: 'completed',   orderStatus: 'In Transit',         deliveryStatus: 'shipped',   workflowStatus: 'in_transit' },
  delivered:           { printStatus: 'completed',   orderStatus: 'Delivered',          deliveryStatus: 'delivered', workflowStatus: 'delivered' },
  done:                { printStatus: 'completed',   orderStatus: 'Delivered',          deliveryStatus: 'delivered', workflowStatus: 'delivered' }
};

const STAGE_ORDER = ['pending', 'queued', 'processing', 'completed'];

const DASHBOARD_STATUS = {
  pending:       'pending',
  queued:        'print-ready',
  'print-ready': 'print-ready',
  ready:         'print-ready',
  processing:    'printing',
  printing:      'printing',
  completed:     'completed'
};

/** Only approved/sent work reaches the print floor, or all orders for printer inspection. */
router.get('/queue', printerAuth, async (_req, res) => {
  try {
    const Order = require('../models/Order');
    // Lightweight projection: exclude heavy embedded arrays not needed for queue listing
    const queueProjection = {
      designData: 0,
      designRevisions: 0,
      printGenerationErrors: 0,
      activityLogs: 0,
      customerApprovedImages: 0,
    };
    const orders = await Order.find({}, queueProjection).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      queue: orders.map(o => {
        const filesArray = Array.isArray(o.printFiles) ? o.printFiles : [];
        const file = filesArray.filter(Boolean)[0];
        const ws = o.workflowStatus;
        // Map workflowStatus to the frontend PrintStatus vocabulary
        let dashStatus = DASHBOARD_STATUS[o.printStatus] || 'pending';
        if (ws === 'sent_to_printer') dashStatus = 'pending';
        else if (ws === 'printer_processing') dashStatus = 'processing';
        else if (ws === 'completed') dashStatus = 'completed';
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
          status: dashStatus,
          printStatus: o.printStatus,
          workflowStatus: o.workflowStatus,
          orderStatus: o.orderStatus,
          priority: o.priority || 'normal',
          images: o.images || [],
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
      })
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
    const { existsInS3 } = require('../utils/s3Storage');

    let file = (Array.isArray(order.printFiles) ? order.printFiles : [])[0];
    let needsGeneration = !file || !file.url;

    if (file && file.url) {
      const s3Key = file.url.split('?')[0].replace(/^\/uploads\//, '');
      // S3 is the only persistent store - a missing local scratch copy is
      // normal (the generator deletes it once uploaded), so only regenerate
      // if the file is actually gone from S3 too.
      if (!(await existsInS3(s3Key))) {
        needsGeneration = true;
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

          // The regenerated file always gets a fresh S3 key (timestamped
          // filename), so the stale record is replaced rather than reused.
          file = newFile;
          await db.updateOrder(order.id, {
            printFiles: [file],
            pdfUrl: file.url,
            printStatus: 'processing',
            printGenerationStatus: 'success'
          });
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
      for (const [idx, img] of images.entries()) {
        const photoNum = String(idx + 1).padStart(2, '0');
        const ext = path.extname(img.url.split('?')[0]) || '.jpg';
        const fileName = `${orderNum}_${skuRaw}_${photoNum}${ext}`;
        const basename = path.basename(img.url.split('?')[0]);
        const s3Key = img.url.split('?')[0].replace(/^\/uploads\//, '');
        const fullPath = path.join(os.tmpdir(), 'prink-uploads', s3Key);

        if (!fs.existsSync(fullPath)) {
          try {
            const { existsInS3, restoreFromS3 } = require('../utils/s3Storage');
            const hasDbFile = await existsInS3(s3Key);
            if (hasDbFile) {
              await restoreFromS3(s3Key, fullPath);
            }
          } catch (restoreErr) {
            console.error(`[BATCH DOWNLOAD] S3 restore failed for ${basename}:`, restoreErr.message);
          }
        }

        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          zip.addFile(`${folderName}/${fileName}`, content);
          addedFileCount++;
        }
      }

      // 2. Process generated print files / PDFs
      const printFiles = (Array.isArray(order.printFiles) ? order.printFiles : []).filter(f => f && f.url);
      for (const [idx, file] of printFiles.entries()) {
        const ext = path.extname(file.url.split('?')[0]) || '.pdf';
        const fileName = `${orderNum}_${skuRaw}_PrintFile_${String(idx + 1).padStart(2, '0')}${ext}`;
        const basename = path.basename(file.url.split('?')[0]);
        const s3Key = file.url.split('?')[0].replace(/^\/uploads\//, '');
        const fullPath = path.join(os.tmpdir(), 'prink-uploads', s3Key);

        if (!fs.existsSync(fullPath)) {
          try {
            const { existsInS3, restoreFromS3 } = require('../utils/s3Storage');
            const hasDbFile = await existsInS3(s3Key);
            if (hasDbFile) {
              await restoreFromS3(s3Key, fullPath);
            }
          } catch (restoreErr) {
            console.error(`[BATCH DOWNLOAD] S3 restore failed for ${basename}:`, restoreErr.message);
          }
        }

        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          zip.addFile(`${folderName}/${fileName}`, content);
          addedFileCount++;
        }
      }

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
    const isApprovedOrUploaded = order.adminApprovalStatus === 'approved' || order.workflowStatus === 'photo_uploaded' || order.workflowStatus === 'approved' || order.workflowStatus === 'printing' || order.workflowStatus === 'ready_for_dispatch' || order.workflowStatus === 'in_transit' || order.workflowStatus === 'delivered' || order.requiresCustomization === false || order.customizationStatus === 'completed' || order.uploadStatus === 'ready';
    if (!isApprovedOrUploaded) {
      return res.status(403).json({ success: false, error: 'This order has not been approved for printing yet.' });
    }

    // Validate transition sequence limits
    const currentPrintStatus = order.printStatus || 'pending';
    const targetPrintStatus = transition.printStatus;
    const currIdx = STAGE_ORDER.indexOf(currentPrintStatus);
    const nextIdx = STAGE_ORDER.indexOf(targetPrintStatus);
    if (currIdx !== -1 && nextIdx !== -1 && nextIdx > currIdx + 1) {
      return res.status(409).json({
        success: false,
        code: 'INVALID_TRANSITION',
        error: `Cannot skip production stages from "${currentPrintStatus}" to "${targetPrintStatus}".`
      });
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
