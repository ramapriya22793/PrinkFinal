const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const { PRINT_DIR, ensureDirs, resolveOriginalImageSource } = require('./printRenderer');
const { saveToS3 } = require('./s3Storage');

const mmToPt = (mm) => (mm / 25.4) * 72;

/**
 * Exact Technical Blueprint & Production Sample Specifications:
 * Sheet Width: 330.148 mm (Super B / 13 inch photo paper width)
 * Sheet Height: 498.900 mm (24.966 top + 457.200 grid + 16.734 bottom)
 * Red Cut Boundary: 304.799 mm x 457.200 mm (12.0 x 18.0 inches)
 * Grid: 4 columns x 5 rows = 20 polaroid cards
 * Card Width: 69.916 mm
 * Column Gap: 6.284 mm
 * Column Pitch: 76.200 mm (3.0 inches = 69.916 card + 6.284 gap)
 * Outer Left Gutter: 3.142 mm, Outer Right Gutter: 3.142 mm
 * Card Height: 91.440 mm (3.6 inches = 71.162 photo + 20.278 chin)
 * Row Gap: 0 mm (rows touch chin-to-top)
 * Side Margins (Sheet Left & Right): (330.148 - 304.799) / 2 = 12.6745 mm
 * Top Margin to Grid: 24.966 mm
 * Bottom Margin from Grid: 16.734 mm
 * Barcode Box: 30.000 mm x 11.681 mm (4 header boxes, 1 per column)
 * Order Number Label: Bold text beside each barcode box
 */
const SHEET_WIDTH_MM = 330.148;
const SHEET_HEIGHT_MM = 498.900;
const COLS = 4;
const ROWS = 5;
const CARDS_PER_PAGE = COLS * ROWS; // 20

const CARD_WIDTH_MM = 69.916;
const PHOTO_HEIGHT_MM = 71.162;
const CHIN_HEIGHT_MM = 20.278;
const CARD_HEIGHT_MM = PHOTO_HEIGHT_MM + CHIN_HEIGHT_MM; // 91.440 mm

const COL_GAP_MM = 6.284;
const COL_PITCH_MM = CARD_WIDTH_MM + COL_GAP_MM; // 76.200 mm
const HALF_GAP_MM = COL_GAP_MM / 2; // 3.142 mm

const GRID_WIDTH_MM = 304.799; // exactly 4 * 76.200 mm
const GRID_HEIGHT_MM = ROWS * CARD_HEIGHT_MM; // 457.200 mm

const MARGIN_X_MM = (SHEET_WIDTH_MM - GRID_WIDTH_MM) / 2; // 12.6745 mm
const MARGIN_BOTTOM_MM = 16.734;
const GRID_START_Y_MM = SHEET_HEIGHT_MM - MARGIN_BOTTOM_MM - GRID_HEIGHT_MM; // 24.966 mm

const BARCODE_BOX_WIDTH_MM = 30.000;
const BARCODE_BOX_HEIGHT_MM = 11.681;

const SCRIPT_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'script.ttf');

/**
 * Draw a vector Code-128 style barcode simulation inside the 30 x 11.681 mm header box,
 * and print the bold order label directly to the right of the box.
 */
function drawHeaderBarcode(doc, cardLeftMm, gridYPt, orderLabel) {
  const boxXPt = mmToPt(cardLeftMm);
  const boxWPt = mmToPt(BARCODE_BOX_WIDTH_MM);
  const boxHPt = mmToPt(BARCODE_BOX_HEIGHT_MM);
  const boxYPt = gridYPt - boxHPt - mmToPt(4.5);

  // 1. Barcode Box (thin black border per blueprint)
  doc.lineWidth(0.5).strokeColor('#000000');
  doc.rect(boxXPt, boxYPt, boxWPt, boxHPt).stroke();

  // 2. Barcode pattern filling inside the box
  const padX = mmToPt(1.2);
  const padY = mmToPt(1.2);
  const innerH = boxHPt - (padY * 2);

  const barPattern = [
    2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1, 1,
    2, 2, 1, 1, 1, 3, 2, 1, 3, 1, 1, 2, 1, 1, 2, 2, 3, 1, 1, 2, 1, 3, 2, 1
  ];

  let curX = boxXPt + padX;
  const startY = boxYPt + padY;
  doc.fillColor('#000000');

  for (let i = 0; i < barPattern.length; i++) {
    const w = barPattern[i] * 0.48;
    if (curX + w > boxXPt + boxWPt - padX) break;
    doc.rect(curX, startY, w, innerH).fill();
    curX += w + (i % 2 === 0 ? 0.65 : 0.45);
  }

  // 3. Order Number Text directly to the right of the barcode box
  const textX = boxXPt + boxWPt + mmToPt(2.5);
  const maxTextW = mmToPt(COL_PITCH_MM - BARCODE_BOX_WIDTH_MM - 3.5);
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10.0);
  doc.text(String(orderLabel), textX, boxYPt + (boxHPt / 2) - mmToPt(1.8), {
    width: maxTextW,
    align: 'left',
    lineBreak: false
  });
}

/**
 * Draw cut marks, outer corner brackets, perimeter T-marks, and inner intersection crosshairs.
 */
function drawRegistrationMarks(doc, gridXPt, gridYPt, gridWPt, gridHPt) {
  const markLen = mmToPt(4.5);
  const tickLen = mmToPt(2.5);
  doc.lineWidth(0.4).strokeColor('#000000');

  // 1. Grid Intersection Crosshairs (+) at every column divider and row divider
  const crossHalf = mmToPt(3.0);
  for (let c = 1; c < COLS; c++) {
    const x = gridXPt + mmToPt(c * COL_PITCH_MM);
    for (let r = 1; r < ROWS; r++) {
      const y = gridYPt + mmToPt(r * CARD_HEIGHT_MM);
      doc.moveTo(x - crossHalf, y).lineTo(x + crossHalf, y).stroke();
      doc.moveTo(x, y - crossHalf).lineTo(x, y + crossHalf).stroke();
    }
  }

  // 2. Perimeter T-Marks on the grid boundary
  // Top edge dividers
  for (let c = 1; c < COLS; c++) {
    const x = gridXPt + mmToPt(c * COL_PITCH_MM);
    doc.moveTo(x, gridYPt - markLen).lineTo(x, gridYPt).stroke();
    doc.moveTo(x - tickLen, gridYPt).lineTo(x + tickLen, gridYPt).stroke();
  }
  // Bottom edge dividers
  for (let c = 1; c < COLS; c++) {
    const x = gridXPt + mmToPt(c * COL_PITCH_MM);
    const y = gridYPt + gridHPt;
    doc.moveTo(x, y).lineTo(x, y + markLen).stroke();
    doc.moveTo(x - tickLen, y).lineTo(x + tickLen, y).stroke();
  }
  // Left edge dividers
  for (let r = 1; r < ROWS; r++) {
    const y = gridYPt + mmToPt(r * CARD_HEIGHT_MM);
    doc.moveTo(gridXPt - markLen, y).lineTo(gridXPt, y).stroke();
    doc.moveTo(gridXPt, y - tickLen).lineTo(gridXPt, y + tickLen).stroke();
  }
  // Right edge dividers
  for (let r = 1; r < ROWS; r++) {
    const y = gridYPt + mmToPt(r * CARD_HEIGHT_MM);
    const x = gridXPt + gridWPt;
    doc.moveTo(x, y).lineTo(x + markLen, y).stroke();
    doc.moveTo(x, y - tickLen).lineTo(x, y + tickLen).stroke();
  }

  // 3. Four Corner Crop Marks (L brackets) at the 4 grid corners
  // Top-Left
  doc.moveTo(gridXPt - markLen, gridYPt).lineTo(gridXPt, gridYPt).lineTo(gridXPt, gridYPt - markLen).stroke();
  // Top-Right
  doc.moveTo(gridXPt + gridWPt + markLen, gridYPt).lineTo(gridXPt + gridWPt, gridYPt).lineTo(gridXPt + gridWPt, gridYPt - markLen).stroke();
  // Bottom-Left
  doc.moveTo(gridXPt - markLen, gridYPt + gridHPt).lineTo(gridXPt, gridYPt + gridHPt).lineTo(gridXPt, gridYPt + gridHPt + markLen).stroke();
  // Bottom-Right
  doc.moveTo(gridXPt + gridWPt + markLen, gridYPt + gridHPt).lineTo(gridXPt + gridWPt, gridYPt + gridHPt + markLen).stroke();
}

/**
 * Generate a Production-Ready Polaroid PDF Sheet for an order.
 * 
 * @param {Object} options
 * @param {string} options.orderId - The Shopify order number (e.g. "186632-1")
 * @param {Array<Object>} options.images - Array of customer photos (each having url/src/serverFilename/caption)
 * @param {Object} options.order - Full order document from MongoDB
 * @returns {Promise<Object>} Object containing filename, url, path, widthMm, heightMm, dpi
 */
async function generatePolaroidPdf({ orderId, images, order }) {
  ensureDirs();

  if (!images || images.length === 0) {
    throw new Error('Polaroid generator requires at least 1 image.');
  }

  const rawId = String(order?.orderNumber || orderId || 'ORDER').replace(/^#/, '');
  const baseOrder = rawId.split('-')[0];
  const orderLabel = `${baseOrder}-1`;

  // Calculate total pages needed (20 photos per page)
  const totalPages = Math.max(1, Math.ceil(images.length / CARDS_PER_PAGE));

  const pageW = mmToPt(SHEET_WIDTH_MM);
  const pageH = mmToPt(SHEET_HEIGHT_MM);

  const safeOrderId = baseOrder.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `POLAROID_${safeOrderId}_${Date.now()}.pdf`;
  const outputPath = path.join(PRINT_DIR, filename);

  // Pre-process all images to 300 DPI high quality buffers with Sharp
  // Photo area fills the card width (69.916 mm) and photo height (71.162 mm)
  const photoTargetWPx = Math.round((CARD_WIDTH_MM / 25.4) * 300); // ~826 px
  const photoTargetHPx = Math.round((PHOTO_HEIGHT_MM / 25.4) * 300); // ~841 px

  const processedImageBuffers = await Promise.all(
    images.map(async (img) => {
      try {
        let src = null;
        if (img?.src && typeof img.src === 'string' && fs.existsSync(img.src)) {
          src = img.src;
        } else if (img?.path && typeof img.path === 'string' && fs.existsSync(img.path)) {
          src = img.path;
        } else if (img?.url && typeof img.url === 'string' && fs.existsSync(img.url)) {
          src = img.url;
        } else {
          src = await resolveOriginalImageSource(img);
        }

        if (src) {
          return await sharp(src)
            .rotate() // Respect EXIF orientation
            .resize(photoTargetWPx, photoTargetHPx, {
              fit: 'cover',
              position: 'centre'
            })
            .jpeg({ quality: 95 })
            .toBuffer();
        }
      } catch (err) {
        console.warn(`[POLAROID] Failed to load image ${img?.id || 'unknown'}:`, err.message);
      }

      // Placeholder grey box if image could not be loaded
      return await sharp({
        create: {
          width: photoTargetWPx,
          height: photoTargetHPx,
          channels: 3,
          background: { r: 235, g: 238, b: 242 }
        }
      }).jpeg({ quality: 90 }).toBuffer();
    })
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin: 0,
      info: {
        Title: `Polaroid Print Sheet - ${orderLabel}`,
        Author: 'THE PRINK Automation Engine'
      }
    });

    const hasScriptFont = fs.existsSync(SCRIPT_FONT_PATH);
    if (hasScriptFont) {
      try {
        doc.registerFont('Handwritten', SCRIPT_FONT_PATH);
      } catch (fontErr) {
        console.warn('[POLAROID] Could not load script font:', fontErr.message);
      }
    }

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      if (pageIdx > 0) doc.addPage();

      // Page background (seamless white)
      doc.rect(0, 0, pageW, pageH).fill('#ffffff');

      // Grid Origin Points
      const gridXPt = mmToPt(MARGIN_X_MM);
      const gridYPt = mmToPt(GRID_START_Y_MM);
      const gridWPt = mmToPt(GRID_WIDTH_MM);
      const gridHPt = mmToPt(GRID_HEIGHT_MM);

      // 1. Top Barcode Header Blocks (4 boxes, aligned with each of the 4 columns)
      for (let col = 0; col < COLS; col++) {
        const cardLeftMm = MARGIN_X_MM + HALF_GAP_MM + (col * COL_PITCH_MM);
        drawHeaderBarcode(doc, cardLeftMm, gridYPt, orderLabel);
      }

      // 2. Registration / Cut Marks (Corner Brackets, Edge T-marks, and Crosshairs)
      drawRegistrationMarks(doc, gridXPt, gridYPt, gridWPt, gridHPt);

      // 3. Vertical Page Number (P.No. : X) in right margin
      const pNoX = gridXPt + gridWPt + mmToPt(6.0);
      const pNoY = gridYPt + mmToPt(10.0);
      doc.save();
      doc.rotate(90, { origin: [pNoX, pNoY] });
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9.5);
      doc.text(`P.No. : ${pageIdx + 1}`, pNoX, pNoY, {
        lineBreak: false,
        width: mmToPt(60)
      });
      doc.restore();

      // 4. Render 4x5 Grid (20 Polaroid Cards)
      const pageImagesStartIndex = pageIdx * CARDS_PER_PAGE;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const itemIdx = pageImagesStartIndex + (r * COLS + c);
          if (itemIdx >= images.length && images.length >= CARDS_PER_PAGE) {
            // No more images to place on this page
            continue;
          }

          // Card position in millimeters
          const cardLeftMm = MARGIN_X_MM + HALF_GAP_MM + (c * COL_PITCH_MM);
          const cardTopMm = GRID_START_Y_MM + (r * CARD_HEIGHT_MM);

          const cardXPt = mmToPt(cardLeftMm);
          const cardYPt = mmToPt(cardTopMm);
          const cardWPt = mmToPt(CARD_WIDTH_MM);
          const photoHPt = mmToPt(PHOTO_HEIGHT_MM);
          const chinHPt = mmToPt(CHIN_HEIGHT_MM);

          // Draw the photo (fills card width x photo height, 0 inner white border)
          const imgBuffer = processedImageBuffers[itemIdx % processedImageBuffers.length];
          if (imgBuffer) {
            try {
              doc.image(imgBuffer, cardXPt, cardYPt, {
                width: cardWPt,
                height: photoHPt
              });
            } catch (renderErr) {
              console.warn(`[POLAROID] Error embedding image ${itemIdx}:`, renderErr.message);
            }
          }

          // Caption Text in the bottom chin
          const rawImg = images[itemIdx % images.length] || {};
          const captionText = (rawImg.caption || rawImg.text || rawImg.title || '').trim();

          if (captionText) {
            const chinYPt = cardYPt + photoHPt;
            if (hasScriptFont) {
              doc.fillColor('#1e293b').font('Handwritten').fontSize(11.0);
            } else {
              doc.fillColor('#1e293b').font('Times-Italic').fontSize(10.0);
            }
            // Center horizontally and vertically within the chin
            doc.text(captionText, cardXPt + mmToPt(1.5), chinYPt + (chinHPt / 2) - mmToPt(2.2), {
              width: cardWPt - mmToPt(3.0),
              align: 'center',
              ellipsis: true,
              lineBreak: false
            });
          }
        }
      }
    }

    doc.end();

    stream.on('finish', async () => {
      try {
        await saveToS3(`print/${filename}`, outputPath);
      } catch (s3Err) {
        console.warn(`[POLAROID] S3 upload skipped/failed (${s3Err.message}). Local file retained at ${outputPath}`);
      }

      resolve({
        filename,
        path: outputPath,
        url: `/uploads/print/${filename}`,
        widthMm: SHEET_WIDTH_MM,
        heightMm: SHEET_HEIGHT_MM,
        dpi: 300,
        colourSpace: 'RGB',
        effectiveDpi: 300
      });
    });

    stream.on('error', (err) => reject(err));
  });
}

module.exports = {
  SHEET_WIDTH_MM,
  SHEET_HEIGHT_MM,
  GRID_WIDTH_MM,
  GRID_HEIGHT_MM,
  MARGIN_X_MM,
  MARGIN_BOTTOM_MM,
  GRID_START_Y_MM,
  CARD_WIDTH_MM,
  PHOTO_HEIGHT_MM,
  CHIN_HEIGHT_MM,
  CARD_HEIGHT_MM,
  COL_GAP_MM,
  COL_PITCH_MM,
  HALF_GAP_MM,
  BARCODE_BOX_WIDTH_MM,
  BARCODE_BOX_HEIGHT_MM,
  COLS,
  ROWS,
  generatePolaroidPdf
};
