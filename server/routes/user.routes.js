/**
 * User administration (admin only).
 *
 * Password hashes are never returned, and the role field is validated against
 * a whitelist so an admin UI bug cannot mint an arbitrary privilege string.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth.middleware');

const ROLES = ['customer', 'admin', 'printer'];

/** Strip credentials before anything leaves the server. */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    status: u.status,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt
  };
}

router.get('/', adminMiddleware, async (_req, res) => {
  try {
    const users = await db.getUsers();
    res.json({ success: true, users: (users || []).map(publicUser) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { email, password, name, phone, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Role must be one of: ${ROLES.join(', ')}` });
    }
    if (await db.getUserByEmail(email)) {
      return res.status(409).json({ success: false, error: 'A user with that email already exists.' });
    }

    const user = await db.createUser({ email, password, name, phone, role: role || 'customer' });
    res.status(201).json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', adminMiddleware, async (req, res) => {
  try {
    const { name, phone, role, status } = req.body || {};
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Role must be one of: ${ROLES.join(', ')}` });
    }

    // Whitelist: email and password changes go through dedicated flows, and a
    // spread of req.body here would let the caller set arbitrary fields.
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;

    const user = await db.updateUser(req.params.id, updates);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    // Refuse self-deletion, which would lock the operator out mid-session.
    if (req.user && String(req.user.id) === String(req.params.id)) {
      return res.status(409).json({ success: false, error: 'You cannot delete your own account.' });
    }
    await db.deleteUser(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
