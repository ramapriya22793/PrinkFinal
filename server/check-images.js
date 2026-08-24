const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/theprink';
    console.log(`Connecting to database...`);
    
    await mongoose.connect(uri);
    console.log('Connected to MongoDB successfully.');

    const db = mongoose.connection.db;

    // 1. GridFS Files count (bucketName is 'uploads')
    const fileCount = await db.collection('uploads.files').countDocuments();
    console.log(`\n[GRIDFS CHECK] Total files (images and PDFs) stored in database (uploads.files): ${fileCount}`);

    // 2. Sample 10 files
    const sampleFiles = await db.collection('uploads.files').find({}).sort({ uploadDate: -1 }).limit(10).toArray();
    if (sampleFiles.length > 0) {
      console.log('\nRecent file documents stored inside MongoDB GridFS:');
      sampleFiles.forEach((f, idx) => {
        console.log(`  ${idx + 1}. Filename: ${f.filename} | Length: ${(f.length / 1024).toFixed(2)} KB | Uploaded: ${f.uploadDate}`);
      });
    } else {
      console.log('  No files found in GridFS.');
    }

    // 3. Orders with images
    const orderCount = await db.collection('orders').countDocuments({ images: { $exists: true, $not: { $size: 0 } } });
    console.log(`\n[ORDERS CHECK] Total orders with mapped customer photos: ${orderCount}`);

    process.exit(0);
  } catch (err) {
    console.error('Database Check Error:', err);
    process.exit(1);
  }
}
check();
