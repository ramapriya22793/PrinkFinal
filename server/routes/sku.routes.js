const express = require('express');
const router = express.Router();
const db = require('../db');
const ShopifyProduct = require('../models/ShopifyProduct');
const { adminMiddleware } = require('../middleware/auth.middleware');

router.get('/', async (_req, res) => {
  try {
    const skus = await db.getSkuMappings();
    res.json({ success: true, skus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Distinct SKUs from the synced Shopify catalogue, for the admin SKU-mapping
 * form's dropdown. Reads the locally-synced `shopifyproducts` collection (no
 * live Shopify call), so it works offline and returns instantly. If the
 * collection is empty the admin needs to run a Shopify sync first.
 */
router.get('/shopify-catalog', adminMiddleware, async (_req, res) => {
  try {
    const products = await ShopifyProduct.find({}, { title: 1, productType: 1, variants: 1 }).lean();
    const bySku = new Map();
    for (const p of products) {
      for (const v of (p.variants || [])) {
        const sku = (v.sku || '').trim();
        if (!sku || bySku.has(sku)) continue;
        bySku.set(sku, {
          sku,
          productTitle: p.title || '',
          variantTitle: v.title || '',
          shopifyProductType: p.productType || ''
        });
      }
    }
    const catalog = [...bySku.values()].sort(
      (a, b) => a.productTitle.localeCompare(b.productTitle) || a.sku.localeCompare(b.sku)
    );
    res.json({ success: true, count: catalog.length, catalog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Export the SKU mapping table for backup / bulk editing. */
router.get('/export', adminMiddleware, async (_req, res) => {
  try {
    const skus = await db.getSkuMappings();
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      count: (skus || []).length,
      data: skus || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Both create and edit hit this — db.saveSkuMapping upserts on the sku code.
router.post('/', adminMiddleware, async (req, res) => {
  try {
    const sku = await db.saveSkuMapping(req.body);
    res.json({ success: true, sku });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    await db.deleteSkuMapping(req.params.id);
    res.json({ success: true, message: 'SKU deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
