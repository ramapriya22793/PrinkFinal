const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

function getBucket() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return null;
  }
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
}

/**
 * Save a file from disk to GridFS.
 */
async function saveToGridFS(filename, filepath) {
  return new Promise((resolve, reject) => {
    const bucket = getBucket();
    if (!bucket) {
      console.warn(`[GridFS] Cannot save ${filename}: Database not connected`);
      return resolve(false);
    }

    // Check if file exists on disk
    if (!fs.existsSync(filepath)) {
      return reject(new Error(`File not found at ${filepath}`));
    }

    const uploadStream = bucket.openUploadStream(filename);
    const readStream = fs.createReadStream(filepath);

    readStream.pipe(uploadStream)
      .on('error', (err) => {
        console.error(`[GridFS] Error reading file ${filename}:`, err);
        reject(err);
      })
      .on('finish', () => {
        console.log(`[GridFS] Successfully saved ${filename} to database`);
        resolve(true);
      });
  });
}

/**
 * Restore a file from GridFS to disk.
 */
async function restoreFromGridFS(filename, targetPath) {
  const bucket = getBucket();
  if (!bucket) {
    console.warn(`[GridFS] Cannot restore ${filename}: Database not connected`);
    return false;
  }

  // Ensure target directory exists
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[GridFS] Warning: Failed to create directory ${dir}:`, err.message);
    }
  }

  // Check if file exists in GridFS
  const files = await mongoose.connection.db.collection('uploads.files').find({ filename }).toArray();
  if (files.length === 0) {
    console.warn(`[GridFS] File ${filename} not found in database`);
    return false;
  }

  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStreamByName(filename);
    const writeStream = fs.createWriteStream(targetPath);

    downloadStream.pipe(writeStream)
      .on('error', (err) => {
        console.error(`[GridFS] Error writing restored file ${filename}:`, err);
        // Clean up partial file
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        reject(err);
      })
      .on('finish', () => {
        console.log(`[GridFS] Successfully restored ${filename} from database to ${targetPath}`);
        resolve(true);
      });
  });
}

/**
 * Check if a file exists in GridFS.
 */
async function existsInGridFS(filename) {
  const bucket = getBucket();
  if (!bucket) return false;
  const files = await mongoose.connection.db.collection('uploads.files').find({ filename }).toArray();
  return files.length > 0;
}

/**
 * Stream a file from GridFS directly to an HTTP response.
 * Bypasses the filesystem entirely.
 */
async function streamFromGridFSToResponse(filename, res) {
  const bucket = getBucket();
  if (!bucket) {
    res.status(500).send('Database not connected');
    return false;
  }

  // Check if file exists in GridFS
  const files = await mongoose.connection.db.collection('uploads.files').find({ filename }).toArray();
  if (files.length === 0) {
    return false;
  }
  
  // Set basic content type based on extension
  if (filename.endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
    res.setHeader('Content-Type', 'image/jpeg');
  } else if (filename.endsWith('.png')) {
    res.setHeader('Content-Type', 'image/png');
  } else if (filename.endsWith('.webp')) {
    res.setHeader('Content-Type', 'image/webp');
  } else if (filename.endsWith('.svg')) {
    res.setHeader('Content-Type', 'image/svg+xml');
  }

  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStreamByName(filename);
    
    downloadStream.pipe(res)
      .on('error', (err) => {
        console.error(`[GridFS] Error streaming file ${filename} to response:`, err);
        reject(err);
      })
      .on('finish', () => {
        console.log(`[GridFS] Successfully streamed ${filename} directly to client`);
        resolve(true);
      });
  });
}

module.exports = {
  saveToGridFS,
  restoreFromGridFS,
  existsInGridFS,
  streamFromGridFSToResponse
};
