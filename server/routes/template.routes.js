const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth.middleware');
const { resolveTemplate, DEFAULT_TEMPLATES, printPixelSize } = require('../config/printTemplates');

/**
 * Resolve the print template for a SKU. This is the endpoint that keeps the
 * customer preview, the admin editor and the print renderer on identical
 * geometry - they all ask this one question rather than each holding their own
 * copy of the coordinates.
 */
router.get('/resolve', async (req, res) => {
  try {
    const { sku, productType, productTitle } = req.query;

    // An explicit admin SKU->template assignment always wins.
    let assignment = null;
    if (sku) {
      const templates = await db.getTemplates();
      assignment = (templates || []).find(
        t => Array.isArray(t.skuMapping) && t.skuMapping.includes(sku) && t.printArea
      ) || null;
    }

    const template = resolveTemplate({ sku, productType, productTitle }, assignment);
    res.json({
      success: true,
      template,
      pixels: printPixelSize(template),
      source: assignment ? 'admin-assignment' : 'default-catalogue'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Built-in template catalogue, for the admin template builder to start from. */
router.get('/defaults', (_req, res) => {
  res.json({ success: true, templates: DEFAULT_TEMPLATES });
});

router.get('/', async (_req, res) => {
  try {
    const templates = await db.getTemplates();
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', adminMiddleware, async (req, res) => {
  try {
    const template = await db.saveTemplate(req.body);
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', adminMiddleware, async (req, res) => {
  try {
    const template = await db.saveTemplate({ ...req.body, id: req.params.id });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    await db.deleteTemplate(req.params.id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk sync templates to production database
router.post('/bulk-sync', async (req, res) => {
  try {
    const items = req.body.templates || [];
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No templates provided' });
    }
    const Template = require('../models/Template');
    const ops = items.map(item => {
      const doc = { ...item };
      delete doc._id;
      return {
        updateOne: {
          filter: { id: item.id },
          update: { $set: doc },
          upsert: true
        }
      };
    });
    const result = await Template.bulkWrite(ops);
    res.json({ success: true, count: items.length, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
