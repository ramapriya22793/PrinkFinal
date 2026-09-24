const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const CREDENTIALS_PATH = path.join(__dirname, '../config/google-credentials.json');
const OLD_DEPRECATED_SHEET_ID = '1klYTlNaHAZGzJpdEYwcOi1AalQYem7RNOpAj1S0mVOg';
const DEFAULT_SPREADSHEET_ID = '1S53f9TC1bXOLsLB3skQWyDWYIlSFD7WtyEm_bSOLhJs';
const RANGE_NAME = 'Sheet1!A:L';

/**
 * Checks whether a given product / line item qualifies for Google Sheet sync.
 * STRICT RULE: Only Polaroid Photo Prints (20 photos) and Prink Butterfly (8 photos).
 * Do NOT sync selections, option choices, frames, keychains, cards, hampers, etc.
 */
function isEligibleSheetProduct(title, sku, count) {
  const t = (title || '').toLowerCase();
  const s = (sku || '').toLowerCase();

  // 1. Immediately exclude selections / add-ons
  if (t.includes('selection') || s.includes('selection')) return false;

  // 2. Polaroid Photo Prints (20 photos)
  // Matches "Polaroid Photo Print", "Polaroid Photo Prints", "Polaroid Prints", SKU "PG-PP-..."
  // Excludes frames, keychains, grids, and hanging polaroids.
  const isPolaroidPrint = (
    (t.includes('polaroid') && (t.includes('print') || s.startsWith('pg-pp') || s.includes('polaroid-print'))) ||
    s.startsWith('pg-pp-')
  ) && !t.includes('frame') && !t.includes('keychain') && !t.includes('hanging');

  // 3. Prink Butterfly (8 photos)
  // Matches "Prink Butterfly Box", "Butterfly Box", "Prink Butterfly", SKU "PG-BB-...", "BB-..."
  // Excludes butterfly cards and hampers.
  const isButterfly = (
    t.includes('prink butterfly') ||
    t.includes('butterfly box') ||
    s.startsWith('pg-bb-') ||
    s.startsWith('bb-') ||
    (t.includes('butterfly') && !t.includes('card') && !t.includes('hamper'))
  );

  return isPolaroidPrint || isButterfly;
}

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

  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      const { connectDB } = require('../db/connection');
      if (typeof connectDB === 'function') await connectDB();
    }
    const Setting = require('../models/Setting');
    const setting = await Setting.findOne({}).lean();
    if (setting && setting.googleCredentialsJson) {
      return typeof setting.googleCredentialsJson === 'string'
        ? JSON.parse(setting.googleCredentialsJson)
        : setting.googleCredentialsJson;
    }
  } catch (err) {
    console.warn('[GOOGLE SHEETS] Error resolving creds from DB Setting:', err.message);
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
 * 1. Environment variable GOOGLE_SHEET_ID (ignoring old deprecated ID)
 * 2. MongoDB Setting model
 * 3. Default active spreadsheet ID (1S53f9TC1bXOLsLB3skQWyDWYIlSFD7WtyEm_bSOLhJs)
 */
const resolveSpreadsheetId = async () => {
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_ID !== OLD_DEPRECATED_SHEET_ID) {
    return process.env.GOOGLE_SHEET_ID;
  }
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      const { connectDB } = require('../db/connection');
      if (typeof connectDB === 'function') await connectDB();
    }
    const Setting = require('../models/Setting');
    const setting = await Setting.findOne({}).lean();
    if (setting && setting.googleSheetId && setting.googleSheetId !== OLD_DEPRECATED_SHEET_ID) {
      return setting.googleSheetId;
    }
  } catch (_) {}
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
 * Formats a date to D-MMMM-YYYY (IST): e.g. 24-September-2026
 */
const formatDateForWhatsAppSheet = (dateInput) => {
  const date = new Date(dateInput || Date.now());
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const d = istDate.getUTCDate();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const m = months[istDate.getUTCMonth()];
  const yyyy = istDate.getUTCFullYear();
  return `'${d}-${m}-${yyyy}`;
};

/**
 * Cleans phone number to standard 10-digit Indian mobile number
 */
const cleanWhatsAppPhone = (phoneInput) => {
  if (!phoneInput) return '';
  let digits = String(phoneInput).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
};

/**
 * Formats an order object into a sheet row array matching the sheet headers
 */
const formatOrderRow = (order, headers = []) => {
  const cleanOrderNumber = String(order.orderNumber || order.shopifyOrderId || order.id || '').replace(/^#/, '').trim();
  
  let customerName = 'Customer';
  if (order.customer) {
    if (order.customer.firstName || order.customer.lastName) {
      customerName = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim();
    } else if (order.customer.name) {
      customerName = order.customer.name;
    }
  } else if (order.shippingAddress && order.shippingAddress.name) {
    customerName = order.shippingAddress.name;
  }

  const phone = cleanWhatsAppPhone(order.customer?.phone || order.shippingAddress?.phone || order.phone || '');
  const uploadLink = order.uploadLink || '';

  // Check if sheet follows the WhatsApp API format (e.g. headers contain WhatsApp_Number or Template_Name)
  const isWhatsAppFormat = !headers.length || headers.some(h => /whatsapp|template_name|send_trigger|order_number/i.test(String(h || '')));

  if (isWhatsAppFormat) {
    return [
      formatDateForWhatsAppSheet(order.createdAt || order.createdAtShopify),
      cleanOrderNumber,
      customerName,
      phone,
      'Yes',
      uploadLink,
      'Customization Link',
      'English',
      '{{Order Number}}, {{Customer Name}}, {{Upload_Link}}',
      'Yes',
      '',
      ''
    ];
  }

  // Legacy fallback format
  return [
    cleanOrderNumber,
    formatDateForWhatsAppSheet(order.createdAt || order.createdAtShopify),
    customerName,
    order.customer?.email || order.email || '',
    phone,
    order.product || (order.lineItems ? order.lineItems.map(i => `${i.title} (x${i.quantity})`).join(', ') : ''),
    order.totalPrice || '',
    uploadLink,
    order.uploadStatus || 'pending'
  ];
};

/**
 * Main function to sync a single order to Google Sheets (used by real-time webhooks).
 * Checks product eligibility (only Polaroid Photo Prints 20 photos or Prink Butterfly 8 photos).
 * Checks duplicate order numbers in Google Sheet to prevent multiple entries.
 */
const updateSpreadsheet = async (order) => {
  try {
    const cleanOrderNumber = String(order.orderNumber || order.shopifyOrderId || order.id || '').replace(/^#/, '').trim();
    
    // 1. Check Product Eligibility
    const hasEligibleProduct = isEligibleSheetProduct(order.product, order.sku, order.requiredPhotoCount)
      || (order.lineItems && order.lineItems.some(i => isEligibleSheetProduct(i.title, i.sku)));

    if (!hasEligibleProduct) {
      console.log(`[GOOGLE SHEETS] Skipping order #${cleanOrderNumber}: Not an eligible product (Only Polaroid Photo Prints 20 photos and Prink Butterfly 8 photos are synced).`);
      return false;
    }

    const spreadsheetId = await resolveSpreadsheetId();
    if (!spreadsheetId) {
      console.warn('[GOOGLE SHEETS] Spreadsheet ID is missing');
      return false;
    }

    const sheets = await getSheetsClient();
    if (!sheets) return false;
    if (sheets === 'mock') {
      console.log(`[GOOGLE SHEETS] (Mock Mode) Synced order #${cleanOrderNumber}`);
      return true;
    }

    // 2. Read Sheet1 Header Row (Row 1) to dynamically locate Order_Number column
    let headers = [];
    let orderColIndex = 1; // Default to Column B (index 1) for WhatsApp Sheet
    try {
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sheet1!1:1',
      });
      if (headerRes.data.values && headerRes.data.values[0]) {
        headers = headerRes.data.values[0];
        const idx = headers.findIndex(h => /order.*num/i.test(String(h || '')));
        if (idx !== -1) orderColIndex = idx;
      }
    } catch (hErr) {
      console.warn('[GOOGLE SHEETS] Could not read headers:', hErr.message);
    }

    const orderColLetter = String.fromCharCode(65 + orderColIndex);

    // 3. Fetch existing Order Numbers to prevent duplicates
    let isDuplicate = false;
    let existingRowIndex = -1;
    try {
      const colRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `Sheet1!${orderColLetter}:${orderColLetter}`,
      });
      const rows = colRes.data.values || [];
      existingRowIndex = rows.findIndex((r, idx) => {
        if (idx === 0) return false; // Ignore header row
        return r && r[0] && String(r[0]).replace(/^#/, '').trim() === cleanOrderNumber;
      });
      if (existingRowIndex >= 0) {
        isDuplicate = true;
      }
    } catch (fetchErr) {
      console.warn('[GOOGLE SHEETS] Could not fetch existing order column for duplicate check:', fetchErr.message);
    }

    if (isDuplicate) {
      console.log(`[GOOGLE SHEETS] Duplicate webhook prevented: Order #${cleanOrderNumber} already exists in Google Sheet at row ${existingRowIndex + 1}. Skipping append.`);
      return true;
    }

    // 4. Format row data & append new order
    const rowData = formatOrderRow(order, headers);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: RANGE_NAME,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData],
      },
    });

    console.log(`[GOOGLE SHEETS] Successfully appended new order #${cleanOrderNumber} to Google Sheet.`);
    return true;
  } catch (error) {
    console.error(`[GOOGLE SHEETS ERROR] Failed to append order ${order.orderNumber || order.shopifyOrderId}:`, error.message);
    return false;
  }
};

/**
 * Bulk backfill function:
 * Syncs eligible unsynced orders to Google Sheets while preventing duplicates.
 */
const syncAllUnsyncedOrdersToSheet = async () => {
  const ShopifyOrder = require('../models/ShopifyOrder');
  console.log('[SHEETS BACKFILL] Starting bulk sync of eligible unsynced orders...');

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

  // 1. Fetch unsynced orders
  const unsyncedOrders = await ShopifyOrder.find({
    $or: [
      { spreadsheetStatus: { $ne: 'synced' } },
      { spreadsheetStatus: { $exists: false } }
    ]
  })
  .sort({ createdAtShopify: 1 })
  .limit(100)
  .lean();

  if (!unsyncedOrders.length) {
    console.log('[SHEETS BACKFILL] No unsynced orders found in database.');
    return { count: 0, newlyAppended: 0, alreadyInSheet: 0, failed: 0, total: 0 };
  }

  // 2. Filter only eligible products (Polaroid Photo Prints or Prink Butterfly)
  const eligibleOrders = unsyncedOrders.filter(o => {
    return o.lineItems && o.lineItems.some(item => isEligibleSheetProduct(item.title, item.sku));
  });

  // Mark ineligible orders as synced so they don't keep polling
  const ineligibleOrders = unsyncedOrders.filter(o => !eligibleOrders.includes(o));
  if (ineligibleOrders.length > 0) {
    await ShopifyOrder.updateMany(
      { _id: { $in: ineligibleOrders.map(o => o._id) } },
      { $set: { spreadsheetStatus: 'synced' } }
    );
  }

  if (!eligibleOrders.length) {
    console.log('[SHEETS BACKFILL] No eligible Polaroid Photo Prints or Prink Butterfly orders to sync.');
    return { count: 0, newlyAppended: 0, alreadyInSheet: 0, failed: 0, total: unsyncedOrders.length };
  }

  // 3. Read header and existing order numbers from sheet to prevent duplicates
  let headers = [];
  let orderColIndex = 1;
  try {
    const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1!1:1' });
    if (headerRes.data.values && headerRes.data.values[0]) {
      headers = headerRes.data.values[0];
      const idx = headers.findIndex(h => /order.*num/i.test(String(h || '')));
      if (idx !== -1) orderColIndex = idx;
    }
  } catch (_) {}

  const orderColLetter = String.fromCharCode(65 + orderColIndex);
  let existingOrderNumbers = new Set();
  try {
    const colRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Sheet1!${orderColLetter}:${orderColLetter}` });
    const rows = colRes.data.values || [];
    rows.forEach((r, idx) => {
      if (idx > 0 && r && r[0]) {
        existingOrderNumbers.add(String(r[0]).replace(/^#/, '').trim());
      }
    });
  } catch (_) {}

  // Filter out any that already exist in the sheet
  const toAppend = [];
  const alreadySyncedIds = [];

  for (const order of eligibleOrders) {
    const cleanNum = String(order.orderNumber || order.shopifyOrderId).replace(/^#/, '').trim();
    if (existingOrderNumbers.has(cleanNum)) {
      alreadySyncedIds.push(order._id);
    } else {
      toAppend.push({
        _id: order._id,
        orderNum: cleanNum,
        rowData: formatOrderRow(order, headers)
      });
      existingOrderNumbers.add(cleanNum); // Prevent duplicates within batch
    }
  }

  if (alreadySyncedIds.length > 0) {
    await ShopifyOrder.updateMany(
      { _id: { $in: alreadySyncedIds } },
      { $set: { spreadsheetStatus: 'synced' } }
    );
  }

  // Append new rows in chunks
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
    } catch (appendErr) {
      console.error('[SHEETS BACKFILL BATCH ERROR]', appendErr.message);
      totalFailed += chunk.length;
    }
  }

  return {
    count: totalAppended,
    newlyAppended: totalAppended,
    alreadyInSheet: alreadySyncedIds.length,
    failed: totalFailed,
    total: eligibleOrders.length
  };
};

module.exports = {
  updateSpreadsheet,
  getSheetsClient,
  resolveSpreadsheetId,
  resolveCredentials,
  syncAllUnsyncedOrdersToSheet,
  isEligibleSheetProduct,
  formatOrderRow,
  formatDateForWhatsAppSheet,
  cleanWhatsAppPhone
};
