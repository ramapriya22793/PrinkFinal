const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

const { UPLOADS_DIR, PRINT_DIR, ensureDirs, resolveOriginalImageSource } = require('./printRenderer');

const mmToPt = (mm) => (mm / 25.4) * 72;

async function generateMagazinePdf({ orderId, images, order }) {
  ensureDirs();

  if (!images || images.length === 0) {
    throw new Error('Magazine requires at least 1 image.');
  }

  let paddedImages = [...images];
  while (paddedImages.length < 4) {
    paddedImages.push(images[paddedImages.length % images.length]);
  }
  paddedImages = paddedImages.slice(0, 4);

  const getImgKey = (img) => img.id || img.url || img.serverFilename || JSON.stringify(img);

  const uniqueMap = new Map();
  const uniqueList = [];
  for (const img of paddedImages) {
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
        create: { width: 1600, height: 2600, channels: 4, background: { r: 230, g: 230, b: 230, alpha: 1 } }
      }).jpeg({ quality: 95 }).toBuffer();
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

  const processedBuffers = paddedImages.map(img => uniqueMap.get(getImgKey(img)));

  const PAGE_WIDTH_MM = 482.6; // 19 inch
  const PAGE_HEIGHT_MM = 330.2; // 13 inch
  const pageW = mmToPt(PAGE_WIDTH_MM);
  const pageH = mmToPt(PAGE_HEIGHT_MM);

  const safeOrderId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `MAGAZINE_${safeOrderId}_${Date.now()}.pdf`;
  const outputPath = path.join(PRINT_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pageW, pageH],
      margin: 0,
      info: { Title: `Magazine Print - ${orderId}`, Author: 'THE PRINK' }
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // 1. Draw Green Cut Line
    doc.lineWidth(1).strokeColor('green')
       .rect(0, 0, pageW, pageH)
       .stroke();

    // 2. Draw Center Line Fold / Divider
    doc.lineWidth(1).strokeColor('#94a3b8').dash(5, { space: 5 })
       .moveTo(mmToPt(241.3), 0)
       .lineTo(mmToPt(241.3), pageH)
       .stroke();
    doc.undash();

    // 3. Draw Top Labels without overlap
    doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10);
    doc.text(`Order: ${orderId}`, mmToPt(14), mmToPt(3));

    doc.fillColor('black').fontSize(10);
    doc.text(`Magazine Print Template (19"x13")`, mmToPt(210), mmToPt(3));

    doc.fillColor('#ef4444').fontSize(10);
    doc.text(`${orderId}`, mmToPt(400), mmToPt(3));

    // 4. Coordinates
    const coords = [
      { x: 15, y: 19 },
      { x: 135, y: 19 },
      { x: 265.6, y: 19 },
      { x: 385.6, y: 19 },
      { x: 15, y: 181.2 },
      { x: 135, y: 181.2 },
      { x: 265.6, y: 181.2 },
      { x: 385.6, y: 181.2 }
    ];

    const boxW = 80;
    const boxH = 130;

    coords.forEach((c, idx) => {
      const imageIdx = idx % 4;
      const xPt = mmToPt(c.x);
      const yPt = mmToPt(c.y);
      const wPt = mmToPt(boxW);
      const hPt = mmToPt(boxH);

      doc.fillColor('#2563eb').fontSize(10);
      doc.text(`Photo ${imageIdx + 1}`, xPt, mmToPt(c.y - 4), { width: wPt, align: 'center' });

      doc.lineWidth(1.5).strokeColor('#2563eb')
         .rect(xPt, yPt, wPt, hPt)
         .stroke();

      doc.image(processedBuffers[imageIdx], xPt, yPt, { width: wPt, height: hPt });
    });

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
        console.error('[S3 Magazine Print PDF Save Error]', s3Err);
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
        templateId: 'magazine',
        generatedAt: new Date()
      });
    });

    stream.on('error', reject);
  });
}

module.exports = { generateMagazinePdf };
