/**
 * THE PRINK - Server-side print-ready renderer.
 *
 * Rebuilds the customer-approved composition from:
 *     original HD source image  +  template configuration  +  saved transform
 *
 * It never upscales the browser preview. The preview is a low-resolution
 * *view* of the same transform; this module applies that transform to the
 * untouched original at the template's print resolution.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const { printPixelSize, effectiveDpi } = require('../config/printTemplates');
const { computePlacement, normalizeTransform } = require('./designTransform');

const os = require('os');
const isVercel = process.env.VERCEL === '1';

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PRINT_DIR = isVercel ? os.tmpdir() : path.join(UPLOADS_DIR, 'print');

function ensureDirs() {
  const dirs = isVercel ? [] : [UPLOADS_DIR, PRINT_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolve the ORIGINAL (never the optimised preview derivative) source file.
 * Requirement 8: print generation must always use the original asset.
 */
function resolveOriginalPath(image) {
  const candidates = [
    image?.originalKey,
    image?.storageKey,
    image?.serverFilename,
    image?.url && path.basename(image.url)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const cleanCandidate = candidate.startsWith('/') ? candidate.slice(1) : candidate;
    const basename = path.basename(cleanCandidate);
    
    // We should check uploads dir, originals dir, and OS tmp dir (for serverless environments)
    const possiblePaths = [
      path.join(UPLOADS_DIR, basename),
      path.join(UPLOADS_DIR, 'originals', basename),
      path.join(os.tmpdir(), basename)
    ];

    for (const full of possiblePaths) {
      const resolved = path.resolve(full);
      const allowedRoots = [path.resolve(UPLOADS_DIR), path.resolve(os.tmpdir())];
      const isAllowed = allowedRoots.some(root => resolved.startsWith(root));
      if (!isAllowed) continue;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    }
  }
  return null;
}

/**
  * Resolve image source as either a local file path (string) or remote image data (Buffer).
  */
async function resolveOriginalImageSource(image) {
  // 1. Try local resolution first
  let localPath = resolveOriginalPath(image);
  if (localPath) return localPath;
  // 1.5. Try S3 restoration first before GridFS
  try {
    const { existsInS3, restoreFromS3 } = require('./s3Storage');
    const s3Candidates = [
      image?.originalKey,
      image?.storageKey,
      image?.serverFilename,
      image?.url && path.basename(image.url)
    ].filter(Boolean);

    for (const candidate of s3Candidates) {
      const cleanCandidate = candidate.startsWith('/') ? candidate.slice(1) : candidate;
      let s3Key = cleanCandidate;
      if (!s3Key.includes('/')) {
        s3Key = `originals/${s3Key}`;
      }

      const hasFile = await existsInS3(s3Key);
      if (hasFile) {
        const basename = path.basename(s3Key);
        const isVercel = process.env.VERCEL === '1';
        const targetPath = isVercel 
          ? path.join(os.tmpdir(), basename) 
          : path.join(UPLOADS_DIR, 'originals', basename);

        const restored = await restoreFromS3(s3Key, targetPath);
        if (restored) {
          localPath = resolveOriginalPath(image);
          if (localPath) return localPath;
        }
      }
    }
  } catch (s3Err) {
    console.error('[S3 Restore Image Error]', s3Err.message);
  }
  
  // 2. Try restoring from GridFS if local file is missing (e.g. ephemeral serverless reset)
  const candidates = [
    image?.originalKey,
    image?.storageKey,
    image?.serverFilename,
    image?.url && path.basename(image.url)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const cleanCandidate = candidate.startsWith('/') ? candidate.slice(1) : candidate;
    const basename = path.basename(cleanCandidate);
    
    try {
      const { existsInGridFS, restoreFromGridFS } = require('./dbStorage');
      const hasFile = await existsInGridFS(basename);
      if (hasFile) {
        // If Vercel/serverless, write to /tmp. If not, write to standard originals folder.
        const isVercel = process.env.VERCEL === '1';
        const targetPath = isVercel 
          ? path.join(os.tmpdir(), basename) 
          : path.join(UPLOADS_DIR, 'originals', basename);
        
        const restored = await restoreFromGridFS(basename, targetPath);
        if (restored) {
          localPath = resolveOriginalPath(image);
          if (localPath) return localPath;
        }
      }
    } catch (gridfsErr) {
      console.error(`[GridFS Restore Image Error] for ${basename}:`, gridfsErr);
    }
  }
  
  // 3. Check if the URL is a remote HTTP/HTTPS URL (e.g. unsplash mock images)
  const imageUrl = image?.src || image?.url;
  if (imageUrl && imageUrl.startsWith('http')) {
    try {
      console.log(`[IMAGE RESOLVER] Fetching remote image: ${imageUrl}`);
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      console.error(`[IMAGE RESOLVER] Failed to download remote image ${imageUrl}:`, e.message);
    }
  }
  
  return null;
}

/**
 * Render one personalised image into a full-bleed print raster.
 * @returns {Promise<{buffer:Buffer, width:number, height:number, dpi:number,
 *                    effectiveDpi:number, belowMinimumDpi:boolean}>}
 */
async function renderPrintRaster(image, template, transformInput) {
  const canvas = printPixelSize(template);
  const sourcePath = await resolveOriginalImageSource(image);
  
  if (!sourcePath) {
    throw new Error(`Original source image not found for upload ${image?.id || '(unknown)'}`);
  }

  const transform = normalizeTransform(transformInput);

  // Read the original at full resolution. `failOn: 'none'` keeps slightly
  // malformed but decodable customer photos usable instead of failing a job.
  const source = sharp(sourcePath, { failOn: 'none' }).rotate(); // rotate() honours EXIF orientation
  const meta = await source.metadata();
  
  const displayFilename = typeof sourcePath === 'string' 
    ? path.basename(sourcePath) 
    : (image?.name || 'buffer');

  if (!meta.width || !meta.height) {
    throw new Error(`Unable to read dimensions of source image ${displayFilename}`);
  }

  const placement = computePlacement({
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    areaWidth: canvas.width,
    areaHeight: canvas.height,
    transform
  });

  const dpi = effectiveDpi(meta.width, meta.height, template, transform.scale);

  // Resize the ORIGINAL to its placed size, then apply colour adjustments.
  // brightness/contrast use sharp's linear(a, b): out = a*in + b, which is the
  // same model the CSS filter approximates in the preview.
  const a = transform.contrast / 100;
  const b = 255 * (transform.brightness / 100 - 1) - 128 * (a - 1);

  let layer = source
    .resize({
      width: Math.max(1, Math.round(placement.drawWidth)),
      height: Math.max(1, Math.round(placement.drawHeight)),
      fit: 'fill',
      kernel: 'mitchell'
    })
    .linear(a, b);

  if (placement.rotation % 360 !== 0) {
    layer = layer.rotate(placement.rotation, { background: { r: 255, g: 255, b: 255, alpha: 0 } });
  }

  const { data: rawData, info: layerMeta } = await layer.raw().toBuffer({ resolveWithObject: true });
  const layerW = layerMeta.width || 0;
  const layerH = layerMeta.height || 0;

  // Rotation changes the bounding box; re-centre so the rotation pivots about
  // the intended centre point rather than the top-left corner.
  const left = Math.round(placement.centerX - layerW / 2);
  const top = Math.round(placement.centerY - layerH / 2);

  // A "cover" fit (and any zoom above it) intentionally overflows the print
  // area - that overflow is what fills the bleed. sharp refuses to composite a
  // layer larger than the canvas, so crop the layer to the visible region
  // first and composite the remainder at a non-negative origin.
  const srcLeft = Math.max(0, -left);
  const srcTop = Math.max(0, -top);
  const destLeft = Math.max(0, left);
  const destTop = Math.max(0, top);
  const visibleW = Math.min(layerW - srcLeft, canvas.width - destLeft);
  const visibleH = Math.min(layerH - srcTop, canvas.height - destTop);

  const composites = [];
  if (visibleW > 0 && visibleH > 0) {
    const cropped = (srcLeft === 0 && srcTop === 0 && visibleW === layerW && visibleH === layerH)
      ? rawData
      : await sharp(rawData, { raw: { width: layerW, height: layerH, channels: layerMeta.channels } })
          .extract({ left: srcLeft, top: srcTop, width: visibleW, height: visibleH })
          .raw()
          .toBuffer();
    composites.push({
      input: cropped,
      left: destLeft,
      top: destTop,
      raw: { width: visibleW, height: visibleH, channels: layerMeta.channels }
    });
  }
  // If nothing is visible the customer has panned the photo entirely outside
  // the print area; a blank sheet is the correct, non-crashing result.

  const buffer = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(composites)
    .withMetadata({ density: template.dpi || 300 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return {
    buffer,
    width: canvas.width,
    height: canvas.height,
    dpi: template.dpi || 300,
    effectiveDpi: dpi,
    belowMinimumDpi: dpi < (template.dpi || 300)
  };
}

/**
 * Build the print-ready PDF at the template's true physical dimensions,
 * including bleed and crop marks.
 *
 * NOTE ON COLOUR: PDFKit emits DeviceRGB. This function therefore produces an
 * honest high-resolution RGB PDF and records colourSpace:'RGB' in its result.
 * It deliberately does NOT claim CMYK - converting correctly requires an ICC
 * toolchain (e.g. Ghostscript with an output profile), which is not installed
 * here. See docs/PRINT_PIPELINE.md.
 */
async function generatePrintPdf({ orderId, order, image, template, transform }) {
  ensureDirs();

  const { fromLegacyImage } = require('./designTransform');

  const allImages = (order && order.images && order.images.length > 0) 
    ? order.images 
    : (image ? [image] : []);

  if (allImages.length === 0) {
    throw new Error('No customer images available for PDF generation.');
  }

  // Render rasters for ALL images
  const rasters = [];
  for (const img of allImages) {
    try {
      const imgTransform = img.transform || transform || fromLegacyImage(img);
      const r = await renderPrintRaster(img, template, imgTransform);
      rasters.push(r);
    } catch (err) {
      console.warn(`[PRINT RENDERER] Warning rendering image for order ${orderId}:`, err.message);
    }
  }

  if (rasters.length === 0) {
    throw new Error('Failed to render rasters for order images.');
  }

  const raster = rasters[0];
  const { widthMm, heightMm, bleedMm } = template.physical;

  const mmToPt = mm => (mm / 25.4) * 72;
  const pageW = mmToPt(widthMm + bleedMm * 2);
  const pageH = mmToPt(heightMm + bleedMm * 2);

  const safeOrderId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `THEPRINK_${safeOrderId}_${template.id}_${Date.now()}.pdf`;
  const outputPath = path.join(PRINT_DIR, filename);

  return new Promise((resolve, reject) => {
    // Every page is full-bleed artwork at the template's real print size -
    // no A4 "job specification" cover page. The printer only needs the
    // artwork; see the identical change for Butterfly Box in
    // butterflyGenerator.js.
    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin: 0,
      info: {
        Title: `THE PRINK print file ${orderId}`,
        Author: 'THE PRINK',
        Subject: `${template.name} - ${order?.product || ''}`,
        Keywords: `${template.dpi}dpi, bleed ${bleedMm}mm`
      }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const bleedPt = mmToPt(bleedMm);
    const drawArtworkPage = (r) => {
      // Artwork covers the full bleed box.
      doc.image(r.buffer, 0, 0, { width: pageW, height: pageH });

      // Crop marks at the trim box corners.
      if (bleedPt > 0) {
        const markLen = Math.min(bleedPt, mmToPt(5));
        doc.lineWidth(0.5).strokeColor('#000000');
        const corners = [
          [bleedPt, bleedPt, -1, -1],
          [pageW - bleedPt, bleedPt, 1, -1],
          [bleedPt, pageH - bleedPt, -1, 1],
          [pageW - bleedPt, pageH - bleedPt, 1, 1]
        ];
        for (const [x, y, dx, dy] of corners) {
          doc.moveTo(x + dx * 1, y).lineTo(x + dx * markLen, y).stroke();
          doc.moveTo(x, y + dy * 1).lineTo(x, y + dy * markLen).stroke();
        }
      }
    };

    // First raster IS page 1 (already sized correctly above); every
    // subsequent raster gets its own full-bleed page.
    rasters.forEach((r, idx) => {
      if (idx > 0) doc.addPage({ size: [pageW, pageH], margin: 0 });
      drawArtworkPage(r);
    });

    doc.end();
    stream.on('finish', async () => {
      const stats = fs.statSync(outputPath);
      // S3 is the only persistent store - a print file that only exists in
      // this ephemeral temp/uploads dir is effectively lost the moment the
      // server restarts, redeploys, or a different serverless instance
      // handles the next request. Treat a failed save as a failed
      // generation rather than reporting success with an unreachable file.
      // The local copy is deliberately kept (not unlinked) after a
      // successful upload - the /uploads serving middleware already checks
      // local disk before falling back to S3, so this doubles as a free
      // same-instance cache, and it means a test/dev environment where
      // saveToS3 no-ops (no bucket configured) still has a real file to
      // serve instead of silently deleting the only copy that exists.
      try {
        const { saveToS3 } = require('./s3Storage');
        await saveToS3(`print/${filename}`, outputPath);
      } catch (s3Err) {
        console.error('[S3 Print PDF Save Error]', s3Err);
        return reject(s3Err);
      }
      resolve({
        filename,
        path: outputPath,
        url: `/uploads/print/${filename}`,
        bytes: stats.size,
        widthMm: widthMm + bleedMm * 2,
        heightMm: heightMm + bleedMm * 2,
        dpi: raster.dpi,
        effectiveDpi: raster.effectiveDpi,
        belowMinimumDpi: raster.belowMinimumDpi,
        colourSpace: 'RGB',
        templateId: template.id,
        generatedAt: new Date()
      });
    });
    stream.on('error', reject);
  });
}

module.exports = {
  UPLOADS_DIR,
  PRINT_DIR,
  ensureDirs,
  resolveOriginalPath,
  resolveOriginalImageSource,
  renderPrintRaster,
  generatePrintPdf
};
