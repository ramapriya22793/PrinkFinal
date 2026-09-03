const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth.middleware');

router.get('/', async (_req, res) => {
  try {
    const skus = await db.getSkuMappings();
    res.json({ success: true, skus });
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
