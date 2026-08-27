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
// Scratch space only, outside the repo directory - S3 is the persistent store.
const ASSETS_DIR = path.join(os.tmpdir(), 'prink-uploads', 'assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

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

router.get('/', adminMiddleware, async (_req, res) => {
  try {
    const { listS3Objects } = require('../utils/s3Storage');
    const objects = await listS3Objects('assets/');
    const files = objects
      .map(o => {
        const f = path.basename(o.key);
        return { id: f, filename: f, url: `/uploads/assets/${f}`, size: o.size, uploadedAt: o.lastModified };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

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

    // S3 is the only persistent store - the disk copy is scratch space for
    // validation above and is removed as soon as it's durably saved (or on
    // failure, since a local-only copy would vanish on the next deploy anyway).
    const { saveToS3 } = require('../utils/s3Storage');
    try {
      await saveToS3(`assets/${req.file.filename}`, req.file.path);
    } catch (s3Err) {
      console.error('[S3 Asset Save Error]', s3Err);
      fs.unlink(req.file.path, () => {});
      return res.status(502).json({ success: false, error: 'Failed to save the file to storage. Please try again.' });
    }
    fs.unlink(req.file.path, () => {});

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

router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    const target = safeAssetPath(req.params.id);
    if (!target) {
      return res.status(400).json({ success: false, error: 'Invalid asset id' });
    }

    const { existsInS3, deleteFromS3 } = require('../utils/s3Storage');
    const s3Key = `assets/${req.params.id}`;
    if (!(await existsInS3(s3Key))) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    await deleteFromS3(s3Key);
    // Best-effort: only present if this same warm instance served the recent upload.
    if (fs.existsSync(target)) fs.unlink(target, () => {});

    res.json({ success: true, message: 'Asset deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
