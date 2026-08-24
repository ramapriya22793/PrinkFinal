const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth.middleware');

router.get('/', authMiddleware(), async (req, res) => {
  try {
    const notifications = await db.getNotifications(req.user.id);
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/read', authMiddleware(), async (req, res) => {
  try {
    await db.markNotificationsRead(req.user.id);
    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
