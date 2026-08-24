const express = require('express');
const router = express.Router();
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth.middleware');

/** Fields that must never be sent to a browser, even for an admin. */
const SECRET_FIELDS = [
  'shopifyAccessToken', 'shopifyApiSecret', 'shopifyWebhookSecret',
  'storefrontAccessToken', 'awsSecretAccessKey', 'whatsappAccessToken', 'jwtSecret'
];

/**
 * Replace secrets with a masked presence indicator. The admin UI only needs to
 * know whether a credential is configured, never its value - returning the
 * value would put a live Shopify Admin token into browser memory, the network
 * log and any error reporter.
 */
function redactSettings(settings) {
  const out = { ...(settings || {}) };
  for (const field of SECRET_FIELDS) {
    if (out[field]) {
      out[field] = '';
      out[`${field}Configured`] = true;
    } else if (field in out) {
      out[`${field}Configured`] = false;
    }
  }
  return out;
}

// Admin only: even redacted, this exposes store configuration.
router.get('/', adminMiddleware, async (_req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({ success: true, settings: redactSettings(settings) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


router.put('/', adminMiddleware, async (req, res) => {
  try {
    // An empty secret means "unchanged" - the GET above returns secrets as
    // empty strings, so saving the form back would otherwise wipe live
    // credentials on every save.
    const updates = { ...(req.body || {}) };
    for (const field of SECRET_FIELDS) {
      if (updates[field] === '' || updates[field] == null) delete updates[field];
      delete updates[`${field}Configured`];
    }

    const settings = await db.updateSettings(updates);
    res.json({ success: true, settings: redactSettings(settings) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
