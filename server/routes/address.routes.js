const express = require('express');
const router = express.Router();
const Address = require('../models/Address');
const { authMiddleware } = require('../middleware/auth.middleware');

router.get('/', authMiddleware(), async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user.id }).lean();
    res.json({ success: true, addresses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', authMiddleware(), async (req, res) => {
  try {
    const address = new Address({
      id: 'addr_' + Date.now(),
      userId: req.user.id,
      ...req.body
    });
    await address.save();
    res.json({ success: true, address: address.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', authMiddleware(), async (req, res) => {
  try {
    await Address.deleteOne({ id: req.params.id, userId: req.user.id });
    res.json({ success: true, message: 'Address deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
