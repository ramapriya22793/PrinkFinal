const express = require('express');
const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    res.json({
      success: true,
      payment: {
        id: 'pay_' + Date.now(),
        amount: amount || 1000,
        currency: currency || 'INR',
        status: 'created'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/verify', async (req, res) => {
  res.json({ success: true, verified: true });
});

module.exports = router;
