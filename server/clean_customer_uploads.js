const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('./db/connection');
const Order = require('./models/Order');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const PREVIEWS_DIR = path.join(UPLOADS_DIR, 'previews');
const PRINT_DIR = path.join(UPLOADS_DIR, 'print');

function deleteFilesExceptGitkeep(directory) {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      if (file !== '.gitkeep') {
        fs.unlinkSync(fullPath);
        console.log(`Deleted file: ${fullPath}`);
      }
    }
  }
}

async function runCleanup() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to MongoDB.');

    // 1. Reset orders in DB
    console.log('Resetting order customization status and customer uploaded photos in the database...');
    const result = await Order.updateMany(
      {},
      {
        $set: {
          images: [],
          customerApprovedImages: undefined,
          designData: null,
          designRevisions: [],
          uploadStatus: 'pending',
          customizationStatus: 'pending',
          workflowStatus: 'order_received',
          designLockedAt: null,
          customerNotes: '',
          pdfUrl: '',
          printFiles: [],
          printGenerationStatus: 'pending',
          printGenerationErrors: [],
          printStatus: 'queued',
          adminApprovalStatus: 'pending',
          orderStatus: 'Pending',
          activityLogs: [
            {
              type: 'ORDER_IMPORTED',
              text: 'Order status reset to initial state.',
              timestamp: new Date()
            }
          ]
        }
      }
    );

    console.log(`Successfully reset DB. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);

    // 2. Clear filesystem directories
    console.log('Cleaning customer uploaded photos/PDFs from the filesystem...');

    // Clear subdirectories
    deleteFilesExceptGitkeep(ORIGINALS_DIR);
    deleteFilesExceptGitkeep(PREVIEWS_DIR);
    deleteFilesExceptGitkeep(PRINT_DIR);

    // Clear files directly under server/uploads (ignoring subdirectories, dummy files and gitkeep)
    if (fs.existsSync(UPLOADS_DIR)) {
      const mainFiles = fs.readdirSync(UPLOADS_DIR);
      const keepFiles = new Set(['dummy.jpg', 'sample_batch_photo.jpg', 'test_sample_photo.jpg', '.gitkeep']);
      for (const file of mainFiles) {
        const fullPath = path.join(UPLOADS_DIR, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          if (!keepFiles.has(file)) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted upload root file: ${fullPath}`);
          }
        }
      }
    }

    console.log('Cleanup completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  }
}

runCleanup();
