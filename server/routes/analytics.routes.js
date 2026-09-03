const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth.middleware');

router.get('/orders', adminMiddleware, async (_req, res) => {
  try {
    const analytics = await db.getOrderAnalytics();
    res.json({ success: true, analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
