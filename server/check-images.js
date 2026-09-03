const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function check() {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/theprink';
    console.log(`Connecting to database...`);

    await mongoose.connect(uri);
    console.log('Connected to MongoDB successfully.');

    const db = mongoose.connection.db;

    // 1. S3 files count
    if (process.env.AWS_REGION && process.env.S3_BUCKET_NAME) {
      const s3 = new S3Client({ region: process.env.AWS_REGION });
      const listing = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET_NAME }));
      const objects = listing.Contents || [];
      console.log(`\n[S3 CHECK] Total files (images and PDFs) stored in bucket ${process.env.S3_BUCKET_NAME}: ${objects.length}`);

      if (objects.length > 0) {
        console.log('\nRecent files stored in S3:');
        objects
          .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))
          .slice(0, 10)
          .forEach((f, idx) => {
            console.log(`  ${idx + 1}. Key: ${f.Key} | Size: ${(f.Size / 1024).toFixed(2)} KB | Modified: ${f.LastModified}`);
          });
      } else {
        console.log('  No files found in S3.');
      }
    } else {
      console.log('\n[S3 CHECK] Skipped: AWS_REGION / S3_BUCKET_NAME not configured.');
    }

    // 2. Orders with images
    const orderCount = await db.collection('orders').countDocuments({ images: { $exists: true, $not: { $size: 0 } } });
    console.log(`\n[ORDERS CHECK] Total orders with mapped customer photos: ${orderCount}`);

    process.exit(0);
  } catch (err) {
    console.error('Database Check Error:', err);
    process.exit(1);
  }
}
check();
