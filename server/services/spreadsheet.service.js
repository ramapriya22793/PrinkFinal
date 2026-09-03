const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '1S53f9TC1bXOLsLB3skQWyDWYIlSFD7WtyEm_bSOLhJs';
let docCache = null;

const getDoc = async () => {
  if (docCache) return docCache;

  let creds;
  const credsPath = path.join(__dirname, '../config/google-credentials.json');
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try { creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON); } catch (_) {}
  }
  if (!creds && fs.existsSync(credsPath)) {
    try { creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch (_) {}
  }
  if (!creds) {
    console.warn('[SPREADSHEET SERVICE] google-credentials.json or GOOGLE_CREDENTIALS_JSON not found. Spreadsheet automation is disabled.');
    return null;
  }
  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo(); 
  docCache = doc;
  return doc;
};

const updateSpreadsheet = async (order) => {
  try {
    const doc = await getDoc();
    if (!doc) return false;

    // Use the first sheet
    const sheet = doc.sheetsByIndex[0];
    
    // We load all rows to find if this order already exists
    const rows = await sheet.getRows();

    const orderNumber = order.orderNumber || order.shopifyOrderId || order.id;
    const name = order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() : 'Guest';
    const email = order.customer?.email || '';
    const phone = order.customer?.phone || order.shippingAddress?.phone || '';
    const itemsStr = order.lineItems ? order.lineItems.map(i => `${i.title} (x${i.quantity})`).join(', ') : (order.product || '');

    const newRowData = {
      'Order Number': String(orderNumber),
      'Date': new Date(order.createdAt || Date.now()).toLocaleString(),
      'Customer Name': name,
      'Email': email,
      'Phone': phone,
      'Products': itemsStr,
      'Total Price': order.totalPrice || '',
      'Upload Link': order.uploadLink || '',
      'Upload Status': order.uploadStatus || 'pending'
    };

    const existingRow = rows.find(r => String(r.get('Order Number')) === String(orderNumber));

    if (existingRow) {
      // Update existing row
      let updated = false;
      Object.keys(newRowData).forEach(k => {
        try {
          if (existingRow.get(k) !== undefined) {
             existingRow.set(k, newRowData[k]);
             updated = true;
          }
        } catch (e) {}
      });
      if (updated) await existingRow.save();
      console.log(`[SPREADSHEET SERVICE] Updated order ${orderNumber} in spreadsheet.`);
    } else {
      // Create new row
      try {
        await sheet.addRow(newRowData);
        console.log(`[SPREADSHEET SERVICE] Added order ${orderNumber} to spreadsheet.`);
      } catch (err) {
        console.error('[SPREADSHEET SERVICE] Headers likely missing. Please add the following headers to row 1:', Object.keys(newRowData).join(', '));
        // Fallback: append raw array 
        await sheet.addRow(Object.values(newRowData));
      }
    }

    return true;
  } catch (error) {
    console.error(`[SPREADSHEET SERVICE ERROR] Failed to sync order ${order.orderNumber || order.shopifyOrderId}:`, error.message);
    return false;
  }
};

module.exports = {
  updateSpreadsheet
};
