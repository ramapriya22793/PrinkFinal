require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const { getSheetsClient } = require('../services/googleSheetService');
const ShopifyOrder = require('../models/ShopifyOrder');
const crypto = require('crypto');

const SHOPIFY_URL = `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json?status=any&limit=250`;
const HEADERS = { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN };

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const sheets = await getSheetsClient();
    if (!sheets || sheets === 'mock') {
      console.log('Sheets client missing or mock mode active.');
      process.exit(1);
    }

    let allOrderRows = [];
    let nextUrl = SHOPIFY_URL;
    let page = 1;

    console.log('Fetching all orders from Shopify...');

    while (nextUrl) {
      console.log(`Fetching page ${page}... URL: ${nextUrl}`);
      const response = await axios.get(nextUrl, { headers: HEADERS });
      const orders = response.data.orders;
      
      console.log(`Received ${orders.length} orders on page ${page}`);

      for (const o of orders) {
        const uploadToken = crypto.randomBytes(32).toString('hex');
        const uploadLink = `${process.env.FRONTEND_URL || 'https://theprink.in'}/o/${uploadToken}`;

        let customerName = 'Guest';
        if (o.customer) {
          customerName = `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim();
        }
        const email = o.email || o.customer?.email || '';
        const phone = o.customer?.phone || o.shipping_address?.phone || '';
        const itemsStr = o.line_items ? o.line_items.map(i => `${i.title} (x${i.quantity})`).join(', ') : '';

        allOrderRows.push([
          String(o.order_number),
          new Date(o.created_at).toLocaleString(),
          customerName,
          email,
          phone,
          itemsStr,
          o.total_price || '',
          uploadLink,
          'pending'
        ]);
      }

      // Safe Pagination
      const linkHeader = response.headers.link;
      nextUrl = null;
      if (linkHeader) {
        // Link header can contain multiple links, e.g., previous and next
        const links = linkHeader.split(',');
        for (const link of links) {
          if (link.includes('rel="next"')) {
            const match = link.match(/<([^>]+)>/);
            if (match) {
              nextUrl = match[1];
            }
          }
        }
      }

      page++;
      await sleep(1000); // 1 second delay to avoid Shopify rate limits
    }

    console.log(`Fetched ${allOrderRows.length} total orders from Shopify.`);

    if (allOrderRows.length > 0) {
      console.log('Pushing ALL orders to Google Sheets in a single chunk to bypass rate limits...');
      
      // To bypass Google Sheets payload limits, we will do it in chunks of 2000
      const chunkSize = 2000;
      for (let i = 0; i < allOrderRows.length; i += chunkSize) {
        const chunk = allOrderRows.slice(i, i + chunkSize);
        console.log(`Pushing chunk ${Math.floor(i/chunkSize) + 1}...`);
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: 'Sheet1!A:I',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: chunk,
          },
        });
        await sleep(2000); // Sleep 2s between sheet chunks
      }
      
      console.log('SUCCESS! All Shopify orders dumped into the Spreadsheet!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error during bulk sync:', error.message);
    if(error.response) console.error(JSON.stringify(error.response.data));
    process.exit(1);
  }
}

syncAll();
