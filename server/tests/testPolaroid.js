const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { generatePolaroidPdf, SHEET_WIDTH_MM, SHEET_HEIGHT_MM } = require('../utils/polaroidGenerator');

async function runTest() {
  console.log('--- TESTING POLAROID GENERATOR ---');

  // 1. Create a dummy test image if needed
  const testImgPath = path.join(__dirname, 'dummy_polaroid.jpg');
  await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 120, g: 170, b: 230 }
    }
  }).jpeg().toFile(testImgPath);

  // 2. Prepare 20 test photos with captions like Image 1
  const testCaptions = [
    "U know who I'm looking!", "That one memorable trip", "Silly girl. LOL!!", "PC: Husband",
    "Picture perfect", "Panda Kutti", "A big huggie!", "My dear Buddha",
    "Sachin who?", "Live, Love, Always", "Love you, always.", "idk why I like it very much!!",
    "Praise the lord!", "Cringe couples ah!", "Bas Kuch bhi.", "Meri jaan",
    "Our 1st trip", "Best couples", "How to work on ur poses sumu!", "My personal fav"
  ];

  const images = testCaptions.map((caption, i) => ({
    id: `img_${i + 1}`,
    src: testImgPath,
    caption
  }));

  const order = {
    id: '186632',
    orderNumber: '186632-1',
    product: 'Polaroid Prints (Set of 20)',
    productType: 'polaroid'
  };

  try {
    const result = await generatePolaroidPdf({
      orderId: order.id,
      images,
      order
    });

    console.log('[SUCCESS] Polaroid PDF Generated:');
    console.log('Filename:', result.filename);
    console.log('Path:', result.path);
    console.log('Dimensions:', `${result.widthMm} mm x ${result.heightMm} mm`);
    console.log('DPI:', result.dpi);

    if (fs.existsSync(result.path)) {
      const stats = fs.statSync(result.path);
      console.log('File size:', stats.size, 'bytes');
    }

    // Cleanup dummy image
    if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);

    console.log('--- TEST COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('[TEST ERROR]', err);
    process.exit(1);
  }
}

runTest();
