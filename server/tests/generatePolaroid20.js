const fs = require('fs');
const path = require('path');
const { generatePolaroidPdf, SHEET_WIDTH_MM, SHEET_HEIGHT_MM } = require('../utils/polaroidGenerator');

async function run() {
  console.log('=== GENERATING EXACT 20-IN-1 POLAROID PRINT PDF ===');

  const photosDir = path.join(__dirname, '../uploads/polaroid_20_sample');
  const captions = [
    "U know who I'm looking!",
    "That one memorable trip",
    "Silly girl. LOL!!",
    "PC: Husband",

    "Picture perfect",
    "Panda Kutti",
    "A big huggie!",
    "My dear Buddha",

    "Sachin who?",
    "",
    "Love you, always.",
    "idk why I like it very much!!",

    "Praise the lord!",
    "Cringe couples ah!",
    "Bas Kuch bhi.",
    "Meri jaan",

    "Our 1st trip",
    "Best couples",
    "How to work on ur poses sumu!",
    "My personal fav"
  ];

  const photoMapping = [
    20, 19, 18, 17,
    16, 15, 14, 13,
    12, 11, 10, 9,
    8,  7,  6,  5,
    4,  3,  2,  1
  ];

  const images = [];
  for (let i = 0; i < 20; i++) {
    const photoNum = photoMapping[i];
    const photoPath = path.join(photosDir, `polaroid_photo_${photoNum}.jpg`);
    if (!fs.existsSync(photoPath)) {
      throw new Error(`Missing photo file: ${photoPath}`);
    }
    images.push({
      id: `img_${i + 1}`,
      url: photoPath,
      src: photoPath,
      caption: captions[i]
    });
  }

  const order = {
    id: '186632',
    orderNumber: '186632-1',
    product: 'Polaroid Photo Print',
    productType: 'polaroid',
    sku: 'PG-PP-20-02'
  };

  const result = await generatePolaroidPdf({
    orderId: '186632-1',
    images,
    order
  });

  console.log('[SUCCESS] Generated Polaroid PDF:');
  console.log('Filename:', result.filename);
  console.log('Path:', result.path);
  console.log('Dimensions:', `${result.widthMm} mm x ${result.heightMm} mm`);
  console.log('DPI:', result.dpi);

  const stats = fs.statSync(result.path);
  console.log('File size:', stats.size, 'bytes');

  // Copy to named standard output
  const standardPath = path.join(__dirname, '../uploads/print/POLAROID_186632-1_FINAL.pdf');
  fs.copyFileSync(result.path, standardPath);
  console.log('Copied to:', standardPath);

  // Copy to artifact directory so we can inspect
  const artifactTarget = 'C:/Users/CHENNAMMAL/.gemini/antigravity/brain/2cd2ae0d-a675-45ee-93e1-c7691e706dca/polaroid_186632_sample.pdf';
  fs.copyFileSync(result.path, artifactTarget);
  console.log('Copied to artifact:', artifactTarget);
}

run().catch(err => {
  console.error('Failed to generate Polaroid PDF:', err);
  process.exit(1);
});
