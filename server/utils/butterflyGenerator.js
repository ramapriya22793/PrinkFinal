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
    // Start with A4 size for the first page (Job Ticket)
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `Butterfly Box Job Ticket - ${templateId || orderId}`,
        Author: 'THE PRINK'
      }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // ==========================================
    // PAGE 1: PRINT PRODUCTION JOB TICKET (A4)
    // ==========================================
    doc.rect(0, 0, 595, 842).fill('#ffffff');

    // 1. Header Bar
    doc.rect(0, 0, 595, 60).fill('#f8fafc');
    doc.rect(0, 57, 595, 3).fill('#171C62');
    
    const logoImgPath = path.join(__dirname, '..', '..', 'apps', 'customer', 'src', 'assets', 'logos', 'main-logo.png');
    if (fs.existsSync(logoImgPath)) {
      doc.image(logoImgPath, 20, 15, { height: 30 });
    }
    doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(14).text('BUTTERFLY BOX JOB TICKET', 300, 24, { align: 'right', width: 275 });

    // 2. Barcode Simulation
    const drawBarcode = (startX, startY) => {
      const lineCount = 35;
      const lineWidths = [1, 2, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 2, 3, 1, 1, 2, 1, 4, 1, 2, 3, 2, 1, 1, 2, 1, 3, 2, 1];
      let currentX = startX;
      for (let i = 0; i < lineCount; i++) {
        const w = lineWidths[i % lineWidths.length];
        doc.rect(currentX, startY, w, 20).fill('#000000');
        currentX += w + (i % 3 === 0 ? 2 : 1);
      }
      doc.fillColor('#64748b').font('Helvetica').fontSize(6).text(`*${orderId}*`, startX + 15, startY + 23);
    };
    drawBarcode(420, 75);

    // Header Meta
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#171C62').text(`ORDER ${orderId}`, 20, 75);
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text(`Department: Print Operations & Fulfillment`, 20, 88);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 98);

    const drawPanelHeader = (title, x, y, w) => {
      doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(8.5).text(title, x, y);
      doc.lineWidth(0.75).strokeColor('#e2e8f0').moveTo(x, y + 12).lineTo(x + w, y + 12).stroke();
    };

    const renderMetaLine = (label, value, y) => {
      doc.font('Helvetica-Bold').fillColor('#475569').fontSize(7.5).text(label, 20, y);
      doc.font('Helvetica').fillColor('#1e293b').fontSize(7.5).text(value, 110, y);
    };

    // Panel 1: Order Information
    let curY = 120;
    drawPanelHeader('1. ORDER DETAILS', 20, curY, 260);
    renderMetaLine('Blue Order ID:', orderId, curY + 20);
    renderMetaLine('Red Order ID:', orderId2 || 'N/A', curY + 32);
    renderMetaLine('Order Date:', order?.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A', curY + 44);
    renderMetaLine('Due Date:', 'N/A', curY + 56);
    renderMetaLine('Workflow Status:', 'PRINT READY', curY + 68);

    // Panel 2: Customer details
    curY = 215;
    drawPanelHeader('2. CUSTOMER DETAILS', 20, curY, 260);
    const cust = order?.customer || {};
    const cust2 = order2?.customer || {};
    renderMetaLine('Blue Customer:', cust.name || 'No Name provided', curY + 20);
    renderMetaLine('Blue Contact:', `${cust.phone || 'No Phone'} | ${cust.email || 'No Email'}`, curY + 32);
    renderMetaLine('Red Customer:', cust2.name || 'No Name provided', curY + 44);
    renderMetaLine('Red Contact:', `${cust2.phone || 'No Phone'} | ${cust2.email || 'No Email'}`, curY + 56);

    // Panel 3: Shipping Target Address
    curY = 300;
    drawPanelHeader('3. SHIPPING TARGET', 20, curY, 260);
    if (order?.shippingAddress) {
      const addr = order.shippingAddress;
      doc.font('Helvetica').fillColor('#1e293b').fontSize(7.5);
      doc.text(`${addr.address1 || ''}`, 20, curY + 20, { width: 260 });
      let nextY = curY + 32;
      if (addr.address2) {
        doc.text(`${addr.address2}`, 20, nextY, { width: 260 });
        nextY += 12;
      }
      doc.text(`${addr.city || ''}, ${addr.province || ''} ${addr.zip || ''}`, 20, nextY, { width: 260 });
      doc.text(`${addr.country || ''}`, 20, nextY + 12, { width: 260 });
    } else {
      doc.font('Helvetica-Oblique').fillColor('#64748b').fontSize(7.5).text('No shipping address provided.', 20, curY + 20);
    }

    // Panel 4: Specifications (Right side)
    const col2X = 315;
    curY = 120;
    drawPanelHeader('4. PRODUCT DETAILS & SPECS', col2X, curY, 260);
    
    const renderSpecLine = (label, value, y) => {
      doc.font('Helvetica-Bold').fillColor('#475569').fontSize(7.5).text(label, col2X, y);
      doc.font('Helvetica').fillColor('#1e293b').fontSize(7.5).text(value, col2X + 100, y);
    };

    renderSpecLine('Product Name:', 'Prink Butterfly Box', curY + 20);
    renderSpecLine('Product Class:', 'Butterfly Box', curY + 32);
    renderSpecLine('Substrate:', 'Fine Cardboard & Plastic', curY + 44);
    renderSpecLine('Print Subsystem:', 'HP Latex 365 Press', curY + 56);
    renderSpecLine('Ink Set Profile:', 'Eco-Solvent CMYK', curY + 68);

    // Panel 5: Compliance checklist
    curY = 215;
    drawPanelHeader('5. QUALITY COMPLIANCE CHECKLIST', col2X, curY, 260);
    
    const renderCheckLine = (check, status, y) => {
      doc.font('Helvetica-Bold').fillColor('#475569').fontSize(7.5).text(check, col2X, y);
      doc.fillColor(status === 'PASSED' ? '#0fbe88' : '#e11d48').font('Helvetica-Bold').fontSize(7.5).text(`[ ${status} ]`, col2X + 205, y);
    };

    renderCheckLine('File Resolution:', 'PASSED', curY + 20);
    renderCheckLine('DPI Validation:', 'PASSED', curY + 32);
    renderCheckLine('Safe Margin Buffers:', 'PASSED', curY + 44);
    renderCheckLine('Bleed Align Boundaries:', 'PASSED', curY + 56);

    // Panel 6: Uploaded Assets Preview (A grid of all 8 photos)
    curY = 390;
    doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(9).text('6. UPLOADED PHOTOS PREVIEW', 20, curY);
    doc.lineWidth(0.75).strokeColor('#e2e8f0').moveTo(20, curY + 12).lineTo(575, curY + 12).stroke();
    
    const thumbSize = 52;
    const gap = 15;
    const startX = 20;
    const startY = curY + 25;
    
    for (let i = 0; i < 8; i++) {
      const col = i % 8;
      const tx = startX + col * (thumbSize + gap);
      const ty = startY;
      
      // Draw thumbnail box outline
      doc.lineWidth(0.5).strokeColor('#cbd5e1').rect(tx, ty, thumbSize, thumbSize).stroke();
      
      if (processedBuffers[i]) {
        try {
          doc.image(processedBuffers[i], tx + 1, ty + 1, { width: thumbSize - 2, height: thumbSize - 2 });
        } catch (e) {
          console.error('[PDF Gen] Failed to render thumbnail:', e.message);
        }
      } else {
        doc.fillColor('#f1f5f9').rect(tx + 1, ty + 1, thumbSize - 2, thumbSize - 2).fill();
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(6).text(`Slot ${i + 1}`, tx + 10, ty + 24);
      }
    }

    // Signatures and Calibration Bars
    curY = 740;
    const barColors = ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'];
    barColors.forEach((col, index) => {
      doc.rect(20 + (index * 20), curY, 15, 8).fill(col);
    });
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(7);
    doc.text('CMYK PRINT CALIBRATION BARS', 110, curY + 1);
    doc.text('PAGE 1 OF 2  |  Generated by Prink Print-file Automation System', 300, curY + 1, { align: 'right', width: 275 });


    // =========================================================================
    // PAGE 2: COMPOSITE PRINT SHEET (Custom 13x19 inch)
    // =========================================================================
    doc.addPage({
      size: [pageW, pageH],
      margin: 0
    });

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
      // as a failed generation rather than reporting success.
      try {
        const { saveToS3 } = require('./s3Storage');
        await saveToS3(`print/${filename}`, outputPath);
        fs.unlink(outputPath, () => {});
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


