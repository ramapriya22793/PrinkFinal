const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSheetsClient } = require('../services/googleSheetService');

async function testSheets() {
  console.log('Testing Google Sheets connection...');
  console.log('GOOGLE_SHEET_ID:', process.env.GOOGLE_SHEET_ID);
  
  const sheets = await getSheetsClient();
  if (!sheets) {
    console.error('getSheetsClient() returned null. Authentication failed.');
    return;
  }
  
  if (sheets === 'mock') {
    console.log('Using mock credentials. No actual connection test performed.');
    return;
  }

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A1:B1',
    });
    console.log('Connection successful! Data:', res.data.values);
  } catch (err) {
    console.error('Google Sheets API Error:', err.message);
    if (err.stack) console.error(err.stack);
  }
}

testSheets();
