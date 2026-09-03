const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME;

let client = null;
function getClient() {
  if (!process.env.AWS_REGION || !BUCKET) return null;
  if (!client) client = new S3Client({ region: process.env.AWS_REGION });
  return client;
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.heic': 'image/heic',
  '.heif': 'image/heif', '.pdf': 'application/pdf'
};

function contentTypeFor(filename) {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

/** Upload a file from disk to S3, keyed by filename. */
async function saveToS3(filename, filepath) {
  const s3 = getClient();
  if (!s3) {
    console.warn(`[S3] Cannot save ${filename}: S3 not configured`);
    return false;
  }
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found at ${filepath}`);
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: filename,
    Body: fs.createReadStream(filepath),
    ContentType: contentTypeFor(filename)
  }));
  console.log(`[S3] Successfully saved ${filename} to ${BUCKET}`);
  return true;
}

/** Upload an in-memory buffer to S3 - no disk touched at all. */
async function saveBufferToS3(key, buffer) {
  const s3 = getClient();
  if (!s3) {
    console.warn(`[S3] Cannot save ${key}: S3 not configured`);
    return false;
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentTypeFor(key)
  }));
  console.log(`[S3] Successfully saved ${key} to ${BUCKET}`);
  return true;
}

/** Download an S3 object to a local path. */
async function restoreFromS3(filename, targetPath) {
  const s3 = getClient();
  if (!s3) {
    console.warn(`[S3] Cannot restore ${filename}: S3 not configured`);
    return false;
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[S3] Warning: Failed to create directory ${dir}:`, err.message);
    }
  }

  let response;
  try {
    response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: filename }));
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      console.warn(`[S3] File ${filename} not found in bucket`);
      return false;
    }
    throw err;
  }

  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(targetPath);
    response.Body.pipe(writeStream)
      .on('error', (err) => {
        console.error(`[S3] Error writing restored file ${filename}:`, err);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        reject(err);
      })
      .on('finish', () => {
        console.log(`[S3] Successfully restored ${filename} from bucket to ${targetPath}`);
        resolve(true);
      });
  });
}

/** Check if an object exists in S3, returning its metadata (or null). */
async function headS3Object(filename) {
  const s3 = getClient();
  if (!s3) return null;
  try {
    const meta = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: filename }));
    return { etag: meta.ETag, lastModified: meta.LastModified, contentLength: meta.ContentLength };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

async function existsInS3(filename) {
  return (await headS3Object(filename)) !== null;
}

/** Delete an object from S3. No-op (returns false) if it doesn't exist or S3 isn't configured. */
async function deleteFromS3(filename) {
  const s3 = getClient();
  if (!s3) return false;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: filename }));
  console.log(`[S3] Deleted ${filename} from ${BUCKET}`);
  return true;
}

/** List objects under a key prefix, e.g. "assets/". Returns [] if S3 isn't configured. */
async function listS3Objects(prefix) {
  const s3 = getClient();
  if (!s3) return [];

  const objects = [];
  let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }));
    for (const obj of page.Contents || []) {
      objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return objects;
}

/** Stream an S3 object directly to an HTTP response, bypassing the filesystem. */
async function streamFromS3ToResponse(filename, res) {
  const s3 = getClient();
  if (!s3) {
    res.status(500).send('S3 not configured');
    return false;
  }

  let response;
  try {
    response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: filename }));
  } catch (err) {
    if (err.name === 'NoSuchKey') return false;
    throw err;
  }

  res.setHeader('Content-Type', contentTypeFor(filename));

  return new Promise((resolve, reject) => {
    response.Body.pipe(res)
      .on('error', (err) => {
        console.error(`[S3] Error streaming file ${filename} to response:`, err);
        reject(err);
      })
      .on('finish', () => {
        console.log(`[S3] Successfully streamed ${filename} directly to client`);
        resolve(true);
      });
  });
}

module.exports = {
  saveToS3,
  saveBufferToS3,
  restoreFromS3,
  existsInS3,
  headS3Object,
  deleteFromS3,
  listS3Objects,
  streamFromS3ToResponse
};
