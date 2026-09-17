const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const crypto = require('crypto');

const { UPLOADS_DIR, PRINT_DIR, ensureDirs, resolveOriginalImageSource } = require('./printRenderer');

const mmToPt = (mm) => (mm / 25.4) * 72;

/**
 * Technical Blueprint Specifications for Butterfly Box (13 x 19 inch sheet):
 * Sheet Size: 330.20 mm x 482.60 mm
 * Safe Margin (Red Box): 320.20 mm x 460.10 mm (offset: x = 5.00 mm, y = 17.45 mm)
 * 
 * Product 1 (Blue lines - Order 1):
 * - 4 Small photos (73 x 73 mm) across the top row:
 *   [ { x: 13.10, y: 36.60 }, { x: 90.10, y: 36.60 }, { x: 167.10, y: 36.60 }, { x: 244.10, y: 36.60 } ]
 * - 4 Large photos (81 x 81 mm) down the left column:
 *   [ { x: 13.10, y: 132.60 }, { x: 13.10, y: 217.60 }, { x: 13.10, y: 302.60 }, { x: 13.10, y: 387.60 } ]
 * - Barcode Box: x = 98.78 mm, y = 116.60 mm, w = 52.92 mm, h = 12.50 mm
 * 
 * Product 2 (Red lines - Order 2):
 * - 4 Large photos (81 x 81 mm) down the middle column:
 *   [ { x: 159.10, y: 132.60 }, { x: 159.10, y: 217.60 }, { x: 159.10, y: 302.60 }, { x: 159.10, y: 387.60 } ]
 * - 4 Small photos (73 x 73 mm) down the right column:
 *   [ { x: 244.10, y: 164.60 }, { x: 244.10, y: 241.60 }, { x: 244.10, y: 318.60 }, { x: 244.10, y: 395.60 } ]
 * - Barcode Box: x = 252.58 mm, y = 130.53 mm, w = 52.89 mm, h = 12.50 mm
 */
const PAGE_WIDTH_MM = 330.20;
const PAGE_HEIGHT_MM = 482.60;
const SAFE_OFFSET_X = 5.00;
const SAFE_OFFSET_Y = 17.45;
const SAFE_WIDTH_MM = 320.20;
const SAFE_HEIGHT_MM = 460.10;

const p1_small = [
  { x: 13.10, y: 36.60 },
  { x: 90.10, y: 36.60 },
  { x: 167.10, y: 36.60 },
  { x: 244.10, y: 36.60 }
];

const p1_large = [
  { x: 13.10, y: 132.60 },
  { x: 13.10, y: 217.60 },
  { x: 13.10, y: 302.60 },
  { x: 13.10, y: 387.60 }
];

const p2_large = [
  { x: 159.10, y: 132.60 },
  { x: 159.10, y: 217.60 },
  { x: 159.10, y: 302.60 },
  { x: 159.10, y: 387.60 }
];

const p2_small = [
  { x: 244.10, y: 164.60 },
  { x: 244.10, y: 241.60 },
  { x: 244.10, y: 318.60 },
  { x: 244.10, y: 395.60 }
];

const p1_barcode = { x: 98.78, y: 116.60, w: 52.92, h: 12.50 };
const p2_barcode = { x: 252.58, y: 130.53, w: 52.89, h: 12.50 };

/**
 * Draw vector Code-128 style barcode simulation pattern inside barcode box
 */
function drawVectorBarcode(doc, xMm, yMm, wMm, hMm) {
  const xPt = mmToPt(xMm);
  const yPt = mmToPt(yMm);
  const wPt = mmToPt(wMm);
  const hPt = mmToPt(hMm);

  const padX = mmToPt(1.5);
  const padY = mmToPt(1.5);
  const innerH = hPt - (padY * 2);

  const barPattern = [
    2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1, 1,
    2, 2, 1, 1, 1, 3, 2, 1, 3, 1, 1, 2, 1, 1, 2, 2, 3, 1, 1, 2, 1, 3, 2, 1,
    1, 3, 1, 2, 2, 1, 1, 2, 3, 1, 2, 1, 1, 1, 3, 2, 1, 2, 2, 1, 1, 3, 1, 2
  ];

  let curX = xPt + padX;
  const startY = yPt + padY;
  doc.fillColor('#000000');

  for (let i = 0; i < barPattern.length; i++) {
    const w = barPattern[i] * 0.52;
    if (curX + w > xPt + wPt - padX) break;
    doc.rect(curX, startY, w, innerH).fill();
    curX += w + (i % 2 === 0 ? 0.75 : 0.5);
  }
}

/**
 * Draw registration and trim marks matching technical blueprint
 */
function drawRegistrationMarks(doc) {
  // Bottom-Left L-mark (x=5.00, y=477.60)
  doc.rect(mmToPt(5.00), mmToPt(457.60), mmToPt(1.00), mmToPt(20.00)).fill('#18181b');
  doc.rect(mmToPt(5.00), mmToPt(476.60), mmToPt(20.00), mmToPt(1.00)).fill('#18181b');

  // Bottom-Right L-mark (x=325.20, y=477.60)
  doc.rect(mmToPt(324.20), mmToPt(457.60), mmToPt(1.00), mmToPt(20.00)).fill('#18181b');
  doc.rect(mmToPt(305.20), mmToPt(476.60), mmToPt(20.00), mmToPt(1.00)).fill('#18181b');

  // Left Margin T-mark (x=5.00, y=64.00)
  doc.rect(mmToPt(5.00), mmToPt(55.00), mmToPt(1.00), mmToPt(20.00)).fill('#18181b');
  doc.rect(mmToPt(5.00), mmToPt(64.00), mmToPt(5.00), mmToPt(1.00)).fill('#18181b');

  // Right Margin T-mark (x=325.20, y=64.00)
  doc.rect(mmToPt(324.20), mmToPt(55.00), mmToPt(1.00), mmToPt(20.00)).fill('#18181b');
  doc.rect(mmToPt(320.20), mmToPt(64.00), mmToPt(5.00), mmToPt(1.00)).fill('#18181b');
}

/**
 * Generate a Print-Ready PDF for the Butterfly Box layout.
 * 
 * @param {Object} options 
 * @param {string} options.orderId - The Order ID
 * @param {Array<Object>} options.images - Array of 8 image objects
 * @param {Object} options.order - Full order object with customer and product details
 * @param {string} [options.orderId2] - The second Order ID (for the Red side)
 * @param {Array<Object>} [options.images2] - Array of 8 image objects for the second order
 * @param {Object} [options.order2] - Full order object for the second order
 * @param {string} [options.templateId] - The shared Butterfly Template ID
 * @returns {Promise<Object>} Object containing filename, url, etc.
 */
async function generateButterflyBoxPdf({ orderId, images, order, orderId2, images2, order2, templateId }) {
  ensureDirs();

  if (!images || images.length === 0) {
    throw new Error('Butterfly Box requires at least 1 image.');
  }

  // If there are fewer than 8 images, duplicate them to fill all 8 slots
  let paddedImages = [...images];
  while (paddedImages.length < 8) {
    paddedImages.push(images[paddedImages.length % images.length]);
  }
  paddedImages = paddedImages.slice(0, 8);

  const getImgKey = (img) => img.id || img.url || img.serverFilename || JSON.stringify(img);
  let missingImageCount = 0;

  // Helper to process a set of padded images by only rendering unique ones
  const processImagesList = async (imgs) => {
    const uniqueMap = new Map();
    const uniqueList = [];
    for (const img of imgs) {
      const key = getImgKey(img);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, null);
        uniqueList.push(img);
      }
    }

    const uniqueResults = await Promise.all(uniqueList.map(async (img) => {
      const src = await resolveOriginalImageSource(img);

      if (!src) {
        console.warn(`[WARNING] Could not find original file for image ${img.id || 'unknown'}. Using placeholder.`);
        missingImageCount++;
        const placeholderBuf = await sharp({
          create: { width: 1000, height: 1000, channels: 4, background: { r: 240, g: 243, b: 246, alpha: 1 } }
        }).jpeg({ quality: 90 }).toBuffer();
        return { buffer: placeholderBuf, width: 1000, height: 1000, isPlaceholder: true };
      }

      // Auto-orient based on EXIF and inspect metadata for exact aspect ratio preservation
      const rotated = sharp(src).rotate();
      const meta = await rotated.metadata();
      const buf = await rotated.jpeg({ quality: 95 }).toBuffer();
      return { buffer: buf, width: meta.width || 1000, height: meta.height || 1000, isPlaceholder: false };
    }));

    uniqueList.forEach((img, index) => {
      const key = getImgKey(img);
      uniqueMap.set(key, uniqueResults[index]);
    });

    return imgs.map(img => uniqueMap.get(getImgKey(img)));
  };

  const processedBuffers = await processImagesList(paddedImages);

  let butterflyCrops = {};
  if (order && order.designData) {
    try {
      const parsed = typeof order.designData === 'string' ? JSON.parse(order.designData) : order.designData;
      if (parsed && parsed.butterflyCrops) {
        butterflyCrops = parsed.butterflyCrops;
      }
    } catch (e) {
      console.error('[PDF GENERATOR] Failed to parse designData crops:', e.message);
    }
  }

  let butterflyCrops2 = {};
  if (order2 && order2.designData) {
    try {
      const parsed = typeof order2.designData === 'string' ? JSON.parse(order2.designData) : order2.designData;
      if (parsed && parsed.butterflyCrops) {
        butterflyCrops2 = parsed.butterflyCrops;
      }
    } catch (e) {
      console.error('[PDF GENERATOR] Failed to parse designData crops 2:', e.message);
    }
  }

  // Process second order images if present
  let processedBuffers2 = [];
  let paddedImages2 = [];
  if (images2 && images2.length > 0) {
    paddedImages2 = [...images2];
    while (paddedImages2.length < 8) paddedImages2.push(images2[paddedImages2.length % images2.length]);
    paddedImages2 = paddedImages2.slice(0, 8);
    
    processedBuffers2 = await processImagesList(paddedImages2);
  }

  const pageW = mmToPt(PAGE_WIDTH_MM);
  const pageH = mmToPt(PAGE_HEIGHT_MM);

  const safeOrderId = templateId || String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `BUTTERFLY_${safeOrderId}_${Date.now()}.pdf`;
  const outputPath = path.join(PRINT_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin: 0,
      info: {
        Title: `Butterfly Box Print Sheet - ${templateId || orderId}`,
        Author: 'THE PRINK'
      }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // =========================================================================
    // COMPOSITE PRINT SHEET (Custom 13x19 inch) — 330.2 x 482.6 mm
    // =========================================================================
    doc.rect(0, 0, pageW, pageH).fill('#ffffff');

    // 1. Draw Green Cut Line (exact sheet boundary)
    doc.lineWidth(1.5).strokeColor('#00963f')
       .rect(0, 0, pageW, pageH)
       .stroke();

    // 2. Draw Red Safe Margin (320.20 x 460.10 mm at offset 5.00, 17.45 mm)
    doc.lineWidth(1.0).strokeColor('#e3000f')
       .rect(mmToPt(SAFE_OFFSET_X), mmToPt(SAFE_OFFSET_Y), mmToPt(SAFE_WIDTH_MM), mmToPt(SAFE_HEIGHT_MM))
       .stroke();

    // 3. Draw Registration / Trim Marks
    drawRegistrationMarks(doc);

    // 4. Helper to draw boxes + images with full crop transforms
    const placeImages = (coords, imgDataList, sizeMm, strokeColor, imgMetaList, cropsMap, startIndex = 0) => {
      coords.forEach((coord, i) => {
        const slotIdx = startIndex + i;
        const xPt = mmToPt(coord.x);
        const yPt = mmToPt(coord.y);
        const sizePt = mmToPt(sizeMm);

        const imgData = imgDataList && imgDataList[i];
        const imgObj = imgMetaList && imgMetaList[i];

        // Draw white card background
        doc.fillColor('#ffffff').rect(xPt, yPt, sizePt, sizePt).fill();

        if (imgData && imgData.buffer && !imgData.isPlaceholder) {
          const crop = (cropsMap && (cropsMap[imgObj?.id] || cropsMap[slotIdx])) || imgObj?.transform || { scale: 1, x: 0, y: 0, rotation: 0 };
          const imgW = imgData.width || imgObj?.width || sizePt;
          const imgH = imgData.height || imgObj?.height || sizePt;
          const aspect = imgW / imgH;

          let drawW = sizePt;
          let drawH = sizePt;
          let dx = 0;
          let dy = 0;

          if (aspect > 1) {
            drawW = sizePt * aspect;
            dx = (sizePt - drawW) / 2;
          } else {
            drawH = sizePt / aspect;
            dy = (sizePt - drawH) / 2;
          }

          const scale = crop.scale || 1;
          const tx = (crop.x || 0) * (sizePt / 240);
          const ty = (crop.y || 0) * (sizePt / 240);

          const finalW = drawW * scale;
          const finalH = drawH * scale;
          const finalX = xPt + dx - (finalW - drawW) / 2 + tx;
          const finalY = yPt + dy - (finalH - drawH) / 2 + ty;

          try {
            doc.save();
            doc.rect(xPt, yPt, sizePt, sizePt).clip();

            if (crop.rotation) {
              const centerX = xPt + sizePt / 2;
              const centerY = yPt + sizePt / 2;
              doc.rotate(crop.rotation, { origin: [centerX, centerY] });
            }

            doc.image(imgData.buffer, finalX, finalY, {
              width: finalW,
              height: finalH
            });
            doc.restore();
          } catch (err) {
            console.error('[PDF GENERATOR] Error rendering butterfly photo:', err.message);
            doc.image(imgData.buffer, xPt, yPt, { width: sizePt, height: sizePt });
          }
        } else if (imgData && imgData.isPlaceholder) {
          doc.fillColor('#cbd5e1').font('Helvetica').fontSize(7).text(`[Photo ${slotIdx + 1}]`, xPt + mmToPt(5), yPt + (sizePt / 2) - 4);
        }

        // Draw border matching technical blueprint (2.5 pt for 81mm, 2.0 pt for 73mm)
        const borderWidth = sizeMm === 81 ? 2.5 : 2.0;
        doc.lineWidth(borderWidth).strokeColor(strokeColor)
           .rect(xPt, yPt, sizePt, sizePt)
           .stroke();
      });
    };

    // Product 1 (Blue lines - Order 1)
    // Photos 0..3 -> 4 Large (81x81mm), Photos 4..7 -> 4 Small (73x73mm)
    const largeImgs = processedBuffers.slice(0, 4);
    const smallImgs = processedBuffers.slice(4, 8);
    placeImages(p1_large, largeImgs, 81, '#0000ff', paddedImages.slice(0, 4), butterflyCrops, 0);
    placeImages(p1_small, smallImgs, 73, '#0000ff', paddedImages.slice(4, 8), butterflyCrops, 4);

    // Product 1 Barcode Box (52.92 x 12.50 mm)
    doc.lineWidth(2.0).strokeColor('#0000ff')
       .rect(mmToPt(p1_barcode.x), mmToPt(p1_barcode.y), mmToPt(p1_barcode.w), mmToPt(p1_barcode.h))
       .stroke();
    drawVectorBarcode(doc, p1_barcode.x, p1_barcode.y, p1_barcode.w, p1_barcode.h);

    // Product 1 Order ID Text (above column per blueprint)
    const order1Num = order?.orderNumber || (orderId ? String(orderId).replace(/[^0-9]/g, '').slice(-6) || String(orderId).slice(-6) : '000001');
    const order1Label = `Bt ${order1Num}`;
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9.5);
    doc.text(order1Label, mmToPt(16.63), mmToPt(120.00), { lineBreak: false });
    doc.text(order1Label, mmToPt(65.00), mmToPt(120.00), { lineBreak: false });

    // Product 2 (Red lines - Order 2)
    // Photos 0..3 -> 4 Large (81x81mm), Photos 4..7 -> 4 Small (73x73mm)
    const hasOrder2 = processedBuffers2.length === 8;
    const largeImgs2 = hasOrder2 ? processedBuffers2.slice(0, 4) : [];
    const smallImgs2 = hasOrder2 ? processedBuffers2.slice(4, 8) : [];
    placeImages(p2_large, largeImgs2, 81, '#ff0000', paddedImages2.slice(0, 4), butterflyCrops2, 0);
    placeImages(p2_small, smallImgs2, 73, '#ff0000', paddedImages2.slice(4, 8), butterflyCrops2, 4);

    // Product 2 Barcode Box (52.89 x 12.50 mm)
    doc.lineWidth(2.0).strokeColor('#ff0000')
       .rect(mmToPt(p2_barcode.x), mmToPt(p2_barcode.y), mmToPt(p2_barcode.w), mmToPt(p2_barcode.h))
       .stroke();

    if (orderId2 || hasOrder2) {
      drawVectorBarcode(doc, p2_barcode.x, p2_barcode.y, p2_barcode.w, p2_barcode.h);
      const order2Num = order2?.orderNumber || (orderId2 ? String(orderId2).replace(/[^0-9]/g, '').slice(-6) || String(orderId2).slice(-6) : '000002');
      const order2Label = `Bt ${order2Num}`;
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9.5);
      doc.text(order2Label, mmToPt(245.87), mmToPt(150.00), { lineBreak: false });
      doc.text(order2Label, mmToPt(285.00), mmToPt(150.00), { lineBreak: false });
    }

    doc.end();

    stream.on('finish', async () => {
      const stats = fs.statSync(outputPath);
      try {
        const { saveToS3 } = require('./s3Storage');
        await saveToS3(`print/${filename}`, outputPath);
      } catch (s3Err) {
        console.error('[S3 Butterfly Print PDF Save Error]', s3Err);
        return reject(s3Err);
      }
      resolve({
        filename,
        path: outputPath,
        url: `/uploads/print/${filename}`,
        bytes: stats.size,
        widthMm: PAGE_WIDTH_MM,
        heightMm: PAGE_HEIGHT_MM,
        dpi: 300,
        effectiveDpi: 300,
        belowMinimumDpi: false,
        colourSpace: 'RGB',
        templateId: 'butterfly-box',
        generatedAt: new Date(),
        missingImages: missingImageCount,
        totalImages: images.length + (images2?.length || 0)
      });
    });

    stream.on('error', reject);
  });
}

module.exports = {
  generateButterflyBoxPdf
};
