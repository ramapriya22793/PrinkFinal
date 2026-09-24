const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const CREDENTIALS_PATH = path.join(__dirname, '../config/google-credentials.json');
const DEFAULT_SPREADSHEET_ID = '1klYTlNaHAZGzJpdEYwcOi1AalQYem7RNOpAj1S0mVOg';
const RANGE_NAME = 'Sheet1!A:I';

/**
 * Dynamically resolves Google credentials from:
 * 1. Environment variable GOOGLE_CREDENTIALS_JSON
 * 2. MongoDB Setting model (stored securely in DB)
 * 3. Local filesystem config/google-credentials.json
 */
const resolveCredentials = async () => {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      return typeof process.env.GOOGLE_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : process.env.GOOGLE_CREDENTIALS_JSON;
    } catch (_) {}
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const Setting = require('../models/Setting');
      const setting = await Setting.findOne({}).lean();
      if (setting && setting.googleCredentialsJson) {
        try {
          return typeof setting.googleCredentialsJson === 'string'
            ? JSON.parse(setting.googleCredentialsJson)
            : setting.googleCredentialsJson;
        } catch (_) {}
      }
    } catch (_) {}
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    } catch (_) {}
  }

  return null;
};

/**
 * Dynamically resolves Google Spreadsheet ID from:
 * 1. Environment variable GOOGLE_SHEET_ID
 * 2. MongoDB Setting model
 * 3. Default active spreadsheet ID
 */
const resolveSpreadsheetId = async () => {
  if (process.env.GOOGLE_SHEET_ID) {
    return process.env.GOOGLE_SHEET_ID;
  }
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const Setting = require('../models/Setting');
      const setting = await Setting.findOne({}).lean();
      if (setting && setting.googleSheetId) {
        return setting.googleSheetId;
      }
    } catch (_) {}
  }
  return DEFAULT_SPREADSHEET_ID;
};

/**
 * Initializes and returns the authenticated Google Sheets API client
 */
const getSheetsClient = async () => {
  try {
    const creds = await resolveCredentials();
    if (!creds) {
      console.warn('[GOOGLE SHEETS] Google credentials not found in env, DB Setting, or file. Cannot authenticate.');
      return null;
    }

    if (creds.private_key && creds.private_key.includes('MOCK_KEY_REPLACE_ME')) {
      console.warn('[GOOGLE SHEETS] Using mock credentials. Skipping actual API call.');
      return 'mock';
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: creds.client_email,
        private_key: creds.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  } catch (error) {
    console.error('[GOOGLE SHEETS ERROR] Failed to initialize client:', error.stack || error.message);
    return null;
  }
};

/**
 * Formats a date to consistent Indian Standard Time (IST): DD/MM/YYYY HH:MM AM/PM
 */
const formatDateIST = (dateInput) => {
  const date = new Date(dateInput || Date.now());
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const dd = String(istDate.getUTCDate()).padStart(2, '0');
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = istDate.getUTCFullYear();
  let hh = istDate.getUTCHours();
  const min = String(istDate.getUTCMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${dd}/${mm}/${yyyy} ${hh}:${min} ${ampm}`;
};

/**
 * Formats an order object into a sheet row array
 */
const formatOrderRow = (order) => {
  const orderNumber = String(order.orderNumber || order.shopifyOrderId || order.id);
  let name = 'Guest';
  if (order.customer) {
    if (order.customer.firstName || order.customer.lastName) {
      name = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim();
    } else if (order.customer.name) {
      name = order.customer.name;
    }
  }

  const email = order.customer?.email || order.email || '';
  const phone = order.customer?.phone || order.shippingAddress?.phone || order.phone || '';
  const itemsStr = order.lineItems
    ? order.lineItems.map(i => `${i.title} (x${i.quantity})`).join(', ')
    : (order.product || '');

  return [
    orderNumber,
    formatDateIST(order.createdAt || order.createdAtShopify),
    name,
    email,
    phone,
    itemsStr,
    order.totalPrice || '',
    order.uploadLink || '',
    order.uploadStatus || 'pending'
  ];
};

/**
 * Main function to sync a single order to Google Sheets (used by real-time webhooks).
 * Handles duplicate checking and status updating.
 */
const updateSpreadsheet = async (order) => {
  try {
    const spreadsheetId = await resolveSpreadsheetId();
    if (!spreadsheetId) {
      console.warn('[GOOGLE SHEETS] Spreadsheet ID is missing');
      return false;
    }

    const sheets = await getSheetsClient();
    if (!sheets) return false;
    if (sheets === 'mock') {
      console.log(`[GOOGLE SHEETS] (Mock Mode) Synced order ${order.orderNumber}`);
      return true;
    }

    const orderNumber = String(order.orderNumber || order.shopifyOrderId || order.id);
    const rowData = formatOrderRow(order);

    // Fetch Column A to check for existing row
    let existingRowIndex = -1;
    try {
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!A:A',
      });
      const rows = getRes.data.values;
      if (rows && rows.length) {
        existingRowIndex = rows.findIndex(row => row && String(row[0]).trim() === orderNumber.trim());
      }
    } catch (fetchErr) {
      console.warn('[GOOGLE SHEETS] Could not fetch existing rows for duplicate check:', fetchErr.message);
    }

    if (existingRowIndex >= 0) {
      const sheetRow = existingRowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!A${sheetRow}:I${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData],
        },
      });
      console.log(`[GOOGLE SHEETS] Successfully updated order ${orderNumber} at row ${sheetRow}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE_NAME,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
      console.log(`[GOOGLE SHEETS] Successfully appended new order ${orderNumber}`);
    }

    return true;
  } catch (error) {
    console.error(`[GOOGLE SHEETS ERROR] Failed to append order ${order.orderNumber || order.shopifyOrderId}:`, error.message);
    return false;
  }
};

/**
 * Bulk backfill function:
 * 1. Reads all existing order numbers from Google Sheet in a single request.
 * 2. Identifies orders already in the sheet and marks them 'synced' in MongoDB.
 * 3. Appends all new unsynced orders in batch chunks of 100 rows per request.
 * 4. Ultra-fast, handles hundreds of orders in seconds within serverless limits.
 */
const syncAllUnsyncedOrdersToSheet = async () => {
  const ShopifyOrder = require('../models/ShopifyOrder');
  console.log('[SHEETS BACKFILL] Starting bulk sync of unsynced orders...');

  const spreadsheetId = await resolveSpreadsheetId();
  if (!spreadsheetId) {
    console.warn('[SHEETS BACKFILL] Missing spreadsheet ID');
    return { count: 0, failed: 0, total: 0, error: 'Missing spreadsheet ID' };
  }

  const sheets = await getSheetsClient();
  if (!sheets || sheets === 'mock') {
    console.warn('[SHEETS BACKFILL] Sheets client unavailable or mock mode');
    return { count: 0, failed: 0, total: 0, error: 'Sheets client unavailable' };
  }

  // 1. Fetch all existing order numbers from Google Sheets in ONE call
  const existingOrderNumbers = new Set();
  try {
    const existingRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:A',
    });
    if (existingRes.data.values) {
      existingRes.data.values.forEach(r => {
        if (r && r[0]) {
          existingOrderNumbers.add(String(r[0]).trim());
        }
      });
    }
    console.log(`[SHEETS BACKFILL] Found ${existingOrderNumbers.size} existing orders in Google Sheet`);
  } catch (err) {
    console.warn('[SHEETS BACKFILL] Could not fetch existing order numbers from sheet:', err.message);
  }

  // 2. Find all orders in DB that are not marked synced
  const unsyncedOrders = await ShopifyOrder.find({
    $or: [
      { spreadsheetStatus: { $ne: 'synced' } },
      { spreadsheetStatus: { $exists: false } }
    ]
  })
  .sort({ createdAtShopify: 1 })
  .lean();

  console.log(`[SHEETS BACKFILL] Found ${unsyncedOrders.length} unsynced orders in database`);

  const alreadyExistingIds = [];
  const toAppend = [];

  for (const order of unsyncedOrders) {
    const orderNum = String(order.orderNumber || order.shopifyOrderId || order.id).trim();
    if (existingOrderNumbers.has(orderNum)) {
      alreadyExistingIds.push(order._id);
    } else {
      toAppend.push({
        _id: order._id,
        orderNum,
        rowData: formatOrderRow(order)
      });
    }
  }

  // Mark orders already in Google Sheet as synced in MongoDB
  if (alreadyExistingIds.length > 0) {
    await ShopifyOrder.updateMany(
      { _id: { $in: alreadyExistingIds } },
      { $set: { spreadsheetStatus: 'synced' } }
    );
    console.log(`[SHEETS BACKFILL] Marked ${alreadyExistingIds.length} orders already in sheet as synced in DB`);
  }

  // Append new orders in batches of 100
  let totalAppended = 0;
  let totalFailed = 0;
  const CHUNK_SIZE = 100;

  for (let i = 0; i < toAppend.length; i += CHUNK_SIZE) {
    const chunk = toAppend.slice(i, i + CHUNK_SIZE);
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE_NAME,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: chunk.map(item => item.rowData),
        },
      });

      const ids = chunk.map(item => item._id);
      await ShopifyOrder.updateMany(
        { _id: { $in: ids } },
        { $set: { spreadsheetStatus: 'synced' } }
      );

      totalAppended += chunk.length;
      chunk.forEach(item => existingOrderNumbers.add(item.orderNum));
      console.log(`[SHEETS BACKFILL] Appended batch of ${chunk.length} orders to Google Sheets`);
    } catch (appendErr) {
      console.error('[SHEETS BACKFILL BATCH ERROR]', appendErr.message);
      totalFailed += chunk.length;
    }
  }

  const grandTotalSynced = alreadyExistingIds.length + totalAppended;
  console.log(`[SHEETS BACKFILL COMPLETE] Newly appended: ${totalAppended}, Already in sheet: ${alreadyExistingIds.length}, Failed: ${totalFailed}`);

  return {
    count: grandTotalSynced,
    newlyAppended: totalAppended,
    alreadyInSheet: alreadyExistingIds.length,
    failed: totalFailed,
    total: unsyncedOrders.length
  };
};

module.exports = {
  updateSpreadsheet,
  getSheetsClient,
  resolveSpreadsheetId,
  resolveCredentials,
  syncAllUnsyncedOrdersToSheet
};
