const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '../config/google-credentials.json');
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const RANGE_NAME = 'Sheet1!A:I';

/**
 * Initializes and returns the authenticated Google Sheets API client
 */
const getSheetsClient = async () => {
  try {
    let creds;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else if (fs.existsSync(CREDENTIALS_PATH)) {
      creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    } else {
      console.warn('[GOOGLE SHEETS] google-credentials.json is missing and no GOOGLE_CREDENTIALS_JSON env var found. Cannot authenticate.');
      return null;
    }

    if (creds.private_key && creds.private_key.includes('MOCK_KEY_REPLACE_ME')) {
      console.warn('[GOOGLE SHEETS] using mock credentials. Skipping actual API call.');
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
 * Main function to sync an order to Google Sheets.
 * Handles duplicate checking and status updating.
 */
/**
 * Formats a date to a consistent Indian format: DD/MM/YYYY HH:MM AM/PM
 * This ensures Google Sheets date filters work reliably regardless of server locale.
 */
const formatDateIST = (dateInput) => {
  const date = new Date(dateInput || Date.now());
  // Format as DD/MM/YYYY HH:MM:SS in IST (UTC+5:30)
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

const updateSpreadsheet = async (order) => {
  try {
    if (!SPREADSHEET_ID) {
      console.warn('[GOOGLE SHEETS] GOOGLE_SHEET_ID is missing from .env');
      return false;
    }

    const sheets = await getSheetsClient();
    if (!sheets) return false;
    if (sheets === 'mock') {
      console.log(`[GOOGLE SHEETS] (Mock Mode) Synced order ${order.orderNumber}`);
      return true;
    }

    const orderNumber = String(order.orderNumber || order.shopifyOrderId || order.id);

    // Support both {firstName, lastName} and {name} customer formats
    let name = 'Guest';
    if (order.customer) {
      if (order.customer.firstName || order.customer.lastName) {
        name = `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim();
      } else if (order.customer.name) {
        name = order.customer.name;
      }
    }

    const email = order.customer?.email || '';
    const phone = order.customer?.phone || order.shippingAddress?.phone || '';
    const itemsStr = order.lineItems
      ? order.lineItems.map(i => `${i.title} (x${i.quantity})`).join(', ')
      : (order.product || '');

    // Use consistent IST date format so Google Sheets date filters work correctly
    const rowData = [
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

    // 1. Fetch only the first column (Order Numbers) to check for duplicates efficiently
    let existingRowIndex = -1;
    try {
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:A',
      });
      
      const rows = getRes.data.values;
      if (rows && rows.length) {
        existingRowIndex = rows.findIndex(row => String(row[0]) === orderNumber);
      }
    } catch (fetchErr) {
      console.warn('[GOOGLE SHEETS] Could not fetch existing rows for duplicate check:', fetchErr.message);
      // We will proceed to append if we can't fetch, or you could return false here.
    }

    if (existingRowIndex >= 0) {
      // Update existing row
      // Array is 0-indexed, but Google Sheets rows are 1-indexed.
      const sheetRow = existingRowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!A${sheetRow}:I${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData],
        },
      });
      console.log(`[GOOGLE SHEETS] Successfully updated order ${orderNumber} at row ${sheetRow}`);
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
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

module.exports = {
  updateSpreadsheet,
  getSheetsClient,

  /**
   * Backfill function: Finds ALL ShopifyOrder records in MongoDB that have
   * not been synced to Google Sheets yet (spreadsheetStatus != 'synced')
   * and writes them row-by-row. Processes in batches of 50 to stay within
   * Vercel serverless time limits.
   *
   * Also re-syncs orders where spreadsheetStatus is 'pending' or missing.
   * Call via: GET /api/sheets/sync-all  (manual trigger)
   *           GET /api/cron/sync        (daily cron)
   */
  syncAllUnsyncedOrdersToSheet: async () => {
    const ShopifyOrder = require('../models/ShopifyOrder');
    let totalSynced = 0;
    let totalFailed = 0;
    const BATCH_SIZE = 50;

    console.log('[SHEETS BACKFILL] Starting full backfill of all unsynced orders...');

    // Find all orders that are not yet marked as synced
    const unsyncedOrders = await ShopifyOrder.find({
      $or: [
        { spreadsheetStatus: { $ne: 'synced' } },
        { spreadsheetStatus: { $exists: false } }
      ]
    })
    .sort({ createdAtShopify: 1 }) // oldest first so sheet order is chronological
    .lean();

    console.log(`[SHEETS BACKFILL] Found ${unsyncedOrders.length} unsynced orders to push to Google Sheets`);

    // Process in batches to avoid overloading Google Sheets API rate limits
    for (let i = 0; i < unsyncedOrders.length; i += BATCH_SIZE) {
      const batch = unsyncedOrders.slice(i, i + BATCH_SIZE);
      for (const order of batch) {
        try {
          const success = await updateSpreadsheet(order);
          if (success) {
            await ShopifyOrder.updateOne(
              { _id: order._id },
              { $set: { spreadsheetStatus: 'synced' } }
            );
            totalSynced++;
          } else {
            totalFailed++;
          }
        } catch (err) {
          console.error(`[SHEETS BACKFILL] Failed for order ${order.orderNumber}:`, err.message);
          totalFailed++;
        }
      }
      // Small delay between batches to stay within Google Sheets API rate limits (100 req/100s)
      if (i + BATCH_SIZE < unsyncedOrders.length) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    console.log(`[SHEETS BACKFILL] Done. Synced: ${totalSynced}, Failed: ${totalFailed}`);
    return { count: totalSynced, failed: totalFailed, total: unsyncedOrders.length };
  }
};
