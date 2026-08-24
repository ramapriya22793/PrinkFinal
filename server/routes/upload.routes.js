/**
 * Admin asset library: generic uploads used by the design editor and template
 * builder (backgrounds, decorative assets, logos).
 *
 * Customer photo uploads do NOT come through here - they go through the
 * token-authenticated portal in publicUpload.routes.js, which additionally
 * preserves originals and validates print resolution.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const router = express.Router();
const { adminMiddleware } = require('../middleware/auth.middleware');

const os = require('os');
const isVercel = process.env.VERCEL === '1';
const ASSETS_DIR = isVercel ? os.tmpdir() : path.join(__dirname, '..', 'uploads', 'assets');
if (!isVercel && !fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ASSETS_DIR),
  // Generated names only - a client-supplied filename must never reach the
  // filesystem, or "../../" inside it becomes a path traversal.
  filename: (_req, file, cb) => {
    const ext = ({
      'image/jpeg': '.jpg', 'image/png': '.png',
      'image/webp': '.webp', 'image/svg+xml': '.svg'
    })[file.mimetype] || '.bin';
    cb(null, `asset_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

/** Reject anything that resolves outside the asset directory. */
function safeAssetPath(name) {
  const resolved = path.resolve(ASSETS_DIR, path.basename(String(name)));
  return resolved.startsWith(path.resolve(ASSETS_DIR)) ? resolved : null;
}

router.get('/', adminMiddleware, (_req, res) => {
  try {
    const files = fs.readdirSync(ASSETS_DIR)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const stat = fs.statSync(path.join(ASSETS_DIR, f));
        return { id: f, filename: f, url: `/uploads/assets/${f}`, size: stat.size, uploadedAt: stat.mtime };
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);

    res.json({ success: true, uploads: files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', adminMiddleware, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        error: tooBig ? 'That file is larger than 25MB.' : err.message
      });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'Only JPG, PNG, WEBP or SVG assets are allowed.' });
    }

    // Verify the bytes really decode as an image. SVG is skipped because it is
    // markup rather than a raster; it is served as a static file and never
    // inlined into a page.
    if (req.file.mimetype !== 'image/svg+xml') {
      try {
        const meta = await sharp(req.file.path).metadata();
        if (!meta.width) throw new Error('undecodable');
      } catch {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'That file could not be read as an image.' });
      }
    }

    // Save asset to GridFS for deployment persistence
    const { saveToGridFS } = require('../utils/dbStorage');
    try {
      await saveToGridFS(req.file.filename, req.file.path);
    } catch (gridfsErr) {
      console.error('[GridFS Asset Save Error]', gridfsErr);
    }

    res.json({
      success: true,
      file: {
        id: req.file.filename,
        filename: req.file.filename,
        originalName: path.basename(req.file.originalname).slice(0, 120),
        url: `/uploads/assets/${req.file.filename}`,
        size: req.file.size
      }
    });
  });
});

router.delete('/:id', adminMiddleware, (req, res) => {
  try {
    const target = safeAssetPath(req.params.id);
    if (!target || !fs.existsSync(target)) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    fs.unlinkSync(target);
    res.json({ success: true, message: 'Asset deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
