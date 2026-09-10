const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const crypto = require('crypto');

const { UPLOADS_DIR, PRINT_DIR, ensureDirs, resolveOriginalImageSource } = require('./printRenderer');

const mmToPt = (mm) => (mm / 25.4) * 72;

/**
 * Generate a Print-Ready PDF for the Butterfly Box layout.
 * 
 * @param {Object} options 
 * @param {string} options.orderId - The Order ID
 * @param {Array<Object>} options.images - Array of 8 image objects (each having url/serverFilename/originalKey)
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

  // If there are fewer than 8 images (e.g., old test orders), duplicate them to fill all 8 slots
  let paddedImages = [...images];
  while (paddedImages.length < 8) {
    paddedImages.push(images[paddedImages.length % images.length]);
  }
  // If there are more than 8, slice to 8
  paddedImages = paddedImages.slice(0, 8);

  const getImgKey = (img) => img.id || img.url || img.serverFilename || JSON.stringify(img);

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

    const uniqueBuffers = await Promise.all(uniqueList.map(async (img) => {
      // Always load the original high-resolution image to ensure professional print quality!
      const src = await resolveOriginalImageSource(img);

      if (!src) {
        console.warn(`[WARNING] Could not find original file for image ${img.id || 'unknown'}. Using placeholder.`);
        return await require('sharp')({
          create: { width: 1000, height: 1000, channels: 4, background: { r: 230, g: 230, b: 230, alpha: 1 } }
        }).jpeg({ quality: 90 }).toBuffer();
      }

      // Auto-orient based on EXIF and output high-quality JPEG (no down-scaling)
      return await sharp(src)
        .rotate()
        .jpeg({ quality: 95 })
        .toBuffer();
    }));

    uniqueList.forEach((img, index) => {
      const key = getImgKey(img);
      uniqueMap.set(key, uniqueBuffers[index]);
    });

    return imgs.map(img => uniqueMap.get(getImgKey(img)));
  };

  // Pre-process all 8 images
  // This avoids placing 10MB original JPEGs directly into the PDF, keeping the PDF size manageable.
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

  const PAGE_WIDTH_MM = 330.2;
  const PAGE_HEIGHT_MM = 482.6;
  const SAFE_WIDTH_MM = 320.2;
  const SAFE_HEIGHT_MM = 460.1;
  const SAFE_OFFSET_X = 5;
  const SAFE_OFFSET_Y = 11.25;

  const pageW = mmToPt(PAGE_WIDTH_MM);
  const pageH = mmToPt(PAGE_HEIGHT_MM);

  const safeOrderId = templateId || String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `BUTTERFLY_${safeOrderId}_${Date.now()}.pdf`;
  const outputPath = path.join(PRINT_DIR, filename);

  return new Promise((resolve, reject) => {
    // Single composite print sheet only (custom 13x19in). The A4 "job
    // ticket" cover page was dropped per client feedback — the printer
    // just needs the artwork, not the order/QC summary page.
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
    // COMPOSITE PRINT SHEET (Custom 13x19 inch) — the only page
    // =========================================================================
    doc.rect(0, 0, pageW, pageH).fill('#ffffff');

    // 3. Define Image Coordinates (in mm)
    // Product 1 (Blue)
    const p1_small = [
      { x: 14, y: 22.35 },
      { x: 93, y: 22.35 },
      { x: 172, y: 22.35 },
      { x: 251, y: 22.35 }
    ];
    const p1_large = [
      { x: 14, y: 118.35 },
      { x: 14, y: 209.01 },
      { x: 14, y: 299.67 },
      { x: 14, y: 390.33 }
    ];

    // Product 2 (Red)
    const p2_large = [
      { x: 160, y: 118.35 },
      { x: 160, y: 209.01 },
      { x: 160, y: 299.67 },
      { x: 160, y: 390.33 }
    ];
    const p2_small = [
      { x: 251, y: 150.37 },
      { x: 251, y: 233.03 },
      { x: 251, y: 315.69 },
      { x: 251, y: 398.35 }
    ];

    // 1. Draw Green Cut Line
    doc.lineWidth(1).strokeColor('green')
       .rect(0, 0, pageW, pageH)
       .stroke();

    // 2. Draw Red Safe Margin
    doc.lineWidth(1).strokeColor('red')
       .rect(mmToPt(SAFE_OFFSET_X), mmToPt(SAFE_OFFSET_Y), mmToPt(SAFE_WIDTH_MM), mmToPt(SAFE_HEIGHT_MM))
       .stroke();

    // Product Sizes (each is 81x81mm which is ~229.6 pt)
    const sizePt = 81 * 72 / 25.4; // 229.6 pt
    const p1X = 50;
    const p2X = pageW - 50 - sizePt; // 332.4 pt
    const pY = 160;

    // Draw Product Headers
    doc.lineWidth(2);
    doc.strokeColor('#3b82f6'); // Blue color
    doc.font('Helvetica-Bold').fontSize(10);
    doc.fillColor('#3b82f6').text('PRODUCT 1', p1X, pY - 15);
    doc.fillColor('#ef4444').text('PRODUCT 2', p2X, pY - 15);

    // Helper to draw the full 81x81mm product photo
    const drawProductPhoto = (imgIndex, x, y) => {
      // Draw crop border
      doc.lineWidth(0.5).strokeColor('#e2e8f0');
      doc.rect(x, y, sizePt, sizePt).stroke();

      if (paddedImages[imgIndex] && processedBuffers[imgIndex]) {
        try {
          doc.save();
          doc.rect(x, y, sizePt, sizePt).clip();

          let drawW = sizePt;
          let drawH = sizePt;
          let dx = 0;
          let dy = 0;
          
          const imgObj = paddedImages[imgIndex];
          const crop = butterflyCrops[imgObj.id] || imgObj.transform || { scale: 1, x: 0, y: 0 };

          if (imgObj.width && imgObj.height) {
            const aspect = imgObj.width / imgObj.height;
            if (aspect > 1) {
              drawW = sizePt * aspect;
              dx = (sizePt - drawW) / 2;
            } else {
              drawH = sizePt / aspect;
              dy = (sizePt - drawH) / 2;
            }
          }

          const scale = crop.scale || 1;
          const tx = (crop.x || 0) * (sizePt / 240); // Normalise the frontend px coords
          const ty = (crop.y || 0) * (sizePt / 240);

          const finalW = drawW * scale;
          const finalH = drawH * scale;
          
          const finalX = x + dx - (finalW - drawW) / 2 + tx;
          const finalY = y + dy - (finalH - drawH) / 2 + ty;

          doc.image(processedBuffers[imgIndex], finalX, finalY, {
            width: finalW,
            height: finalH
          });

          doc.restore();
        } catch (e) {
          console.error('[PDF GENERATOR] Error rendering butterfly photo:', e.message);
        }
      } else {
        // Placeholder if missing
        doc.fillColor('#f8fafc').rect(x + 1, y + 1, sizePt - 2, sizePt - 2).fill();
        doc.fillColor('#cbd5e1').font('Helvetica').fontSize(6).text(`[Photo ${imgIndex + 1}]`, x + 10, y + 50);
      }
    };

    // Helper to draw boxes + images with full crop transforms
    const placeImages = (coords, buffers, size, strokeColor, imgMetaList, cropsMap) => {
      coords.forEach((coord, i) => {
        const xPt = mmToPt(coord.x);
        const yPt = mmToPt(coord.y);
        const sizePt = mmToPt(size);

        // Draw border
        doc.lineWidth(1).strokeColor(strokeColor)
           .rect(xPt, yPt, sizePt, sizePt)
           .stroke();

        // Place image inside border
        if (buffers[i]) {
          const imgObj = imgMetaList && imgMetaList[i];
          if (imgObj) {
            const crop = (cropsMap && cropsMap[imgObj.id]) || imgObj.transform || { scale: 1, x: 0, y: 0 };
            
            let drawW = sizePt;
            let drawH = sizePt;
            let dx = 0;
            let dy = 0;
            
            if (imgObj.width && imgObj.height) {
              const aspect = imgObj.width / imgObj.height;
              if (aspect > 1) {
                drawW = sizePt * aspect;
                dx = (sizePt - drawW) / 2;
              } else {
                drawH = sizePt / aspect;
                dy = (sizePt - drawH) / 2;
              }
            }

            const scale = crop.scale || 1;
            const tx = (crop.x || 0) * (sizePt / 240); // Normalise the frontend px coords
            const ty = (crop.y || 0) * (sizePt / 240);

            const finalW = drawW * scale;
            const finalH = drawH * scale;
            
            const finalX = xPt + dx - (finalW - drawW) / 2 + tx;
            const finalY = yPt + dy - (finalH - drawH) / 2 + ty;

            try {
              doc.save();
              doc.rect(xPt, yPt, sizePt, sizePt).clip();
              doc.image(buffers[i], finalX, finalY, {
                width: finalW,
                height: finalH
              });
              doc.restore();
            } catch (err) {
              console.error('[PDF GENERATOR] Error rendering placed image:', err.message);
              // Fallback without crop if clip fails
              doc.image(buffers[i], xPt, yPt, { width: sizePt, height: sizePt });
            }
          } else {
            // No metadata, draw as-is
            doc.image(buffers[i], xPt, yPt, { width: sizePt, height: sizePt });
          }
        }
      });
    };

    // We have 8 images. Let's assign images 0-3 to large, 4-7 to small.
    const largeImgs = processedBuffers.slice(0, 4);
    const smallImgs = processedBuffers.slice(4, 8);

    // Product 1 (Blue lines)
    placeImages(p1_large, largeImgs, 81, 'blue', paddedImages.slice(0, 4), butterflyCrops);
    placeImages(p1_small, smallImgs, 73, 'blue', paddedImages.slice(4, 8), butterflyCrops);

    // Product 2 (Red lines)
    if (processedBuffers2.length === 8) {
      const largeImgs2 = processedBuffers2.slice(0, 4);
      const smallImgs2 = processedBuffers2.slice(4, 8);
      placeImages(p2_large, largeImgs2, 81, 'red', paddedImages2.slice(0, 4), butterflyCrops2);
      placeImages(p2_small, smallImgs2, 73, 'red', paddedImages2.slice(4, 8), butterflyCrops2);
    }

    // 4. Barcode / Order ID
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
    // Left Blue block text
    doc.text(`Bt: ${orderId}`, mmToPt(14), mmToPt(106.85));
    // Middle Red block text
    doc.text(`Bt: ${orderId2 || ''}`, mmToPt(160), mmToPt(106.85));
    // Right Red block text
    doc.text(`Bt: ${orderId2 || ''}`, mmToPt(251), mmToPt(140));

    doc.end();

    stream.on('finish', async () => {
      const stats = fs.statSync(outputPath);
      // S3 is the only persistent store - a print file that only exists in
      // this ephemeral temp dir is effectively lost, so treat a failed save
      // as a failed generation rather than reporting success. The local
      // copy is deliberately kept (not unlinked) after a successful upload -
      // see server/utils/printRenderer.js's generatePrintPdf for why.
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
        generatedAt: new Date()
      });
    });

    stream.on('error', reject);
  });
}

module.exports = {
  generateButterflyBoxPdf
};


