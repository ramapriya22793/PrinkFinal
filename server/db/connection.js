require('../utils/dns-fix');
const mongoose = require('mongoose');

let memServer = null;

/**
 * Strip credentials before logging. A mongodb+srv:// URI embeds the username
 * and password, so printing it raw leaks them into stdout,log files and any
 * log aggregator.
 */
function redact(uri) {
  return String(uri).replace(/\/\/[^@/]+@/, '//***:***@');
}

// Cached connection promise - shared across serverless invocations in same container
let connectionPromise = null;

async function connectDB() {
  // If already fully connected, return immediately
  if (mongoose.connection.readyState === 1) return;

  // If a connection attempt is already in progress, wait for it
  if (connectionPromise) return connectionPromise;

  const getTargetUri = () => process.env.USE_MEMORY_DB === 'true'
    ? 'in-memory'
    : (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/theprink');

  const connectWithUri = async (uri, timeoutMS = 3000) => {
    return mongoose.connect(uri, {
      serverSelectionTimeoutMS: timeoutMS,
      socketTimeoutMS: 30000,
      connectTimeoutMS: timeoutMS,
      maxPoolSize: 10,
      minPoolSize: 1,
      bufferCommands: true,
      maxIdleTimeMS: 30000,
    });
  };

  connectionPromise = (async () => {
    const targetUri = getTargetUri();
    try {
      await connectWithUri(targetUri);
      console.log(`[DATABASE] Connected to MongoDB at ${redact(targetUri)}`);
    } catch (err) {
      console.warn(`[DATABASE WARNING] Primary DB connection failed (${redact(targetUri)}): ${err.message}`);
      
      // If primary URI is local and failed, fall back to MongoMemoryServer
      if (targetUri.includes('localhost') || targetUri.includes('127.0.0.1')) {
        console.log('[DATABASE] Starting in-memory MongoDB fallback...');
        try {
          const { MongoMemoryServer } = require('mongodb-memory-server');
          if (!memServer) {
            memServer = await MongoMemoryServer.create({
              instance: { dbName: 'theprink' }
            });
          }
          const memUri = memServer.getUri();
          await connectWithUri(memUri, 15000);
          console.log(`[DATABASE] Connected to In-Memory MongoDB at ${memUri}`);
        } catch (memErr) {
          console.error('[DATABASE CONNECT ERROR] In-memory fallback failed:', memErr.message);
          memServer = null;
          connectionPromise = null;
          throw memErr;
        }
      } else {
        connectionPromise = null;
        throw err;
      }
    }

    // Trigger index creation asynchronously on connection
    try {
      const Order = mongoose.models.Order || require('../models/Order');
      Order.createIndexes().then(() => {
        console.log('[DATABASE] All Order schema indexes verified/created successfully.');
      }).catch(indexErr => {
        console.error('[DATABASE INDEX ERROR] Failed to create indexes:', indexErr.message);
      });
    } catch (importErr) {
      console.warn('[DATABASE INDEX WARNING] Could not import Order model to build indexes:', importErr.message);
    }
  })();

  return connectionPromise;
}

module.exports = { connectDB, redact };

