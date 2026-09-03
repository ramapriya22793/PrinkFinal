const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');

router.post('/validate', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Coupon code required' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), active: true }).lean();
    if (!coupon) {
      return res.status(404).json({ success: false, error: 'Invalid or expired coupon' });
    }

    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
