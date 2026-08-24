const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    // create some dummy images in uploads
    const dummyImg = path.join(__dirname, '..', 'uploads', 'dummy.jpg');
    if (!fs.existsSync(dummyImg)) {
      // Just copy package.json as a dummy? No, it needs to be an image.
      // We will create a blank dummy jpeg using sharp.
      const sharp = require('sharp');
      await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } } })
        .jpeg()
        .toFile(dummyImg);
    }

    const images = Array(8).fill({ originalKey: 'dummy.jpg', id: 'img_test' });
    const result = await generateButterflyBoxPdf({ orderId: 'TEST_ORDER_123', images });
    console.log('Success!', result);
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
