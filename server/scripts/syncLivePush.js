require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const { getSheetsClient } = require('../services/googleSheetService');
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

    let nextUrl = SHOPIFY_URL;
    let page = 1;

    console.log('Fetching orders from Shopify and PUSHING LIVE...');

    while (nextUrl) {
      console.log(`Fetching page ${page}...`);
      const response = await axios.get(nextUrl, { headers: HEADERS });
      const orders = response.data.orders;
      
      console.log(`Received ${orders.length} orders on page ${page}`);
      
      if (orders.length > 0) {
        let chunk = [];
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

          chunk.push([
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

        console.log(`Pushing page ${page} directly to Google Sheets...`);
        try {
          await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:I',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: chunk },
          });
        } catch (e) {
          console.log("Failed to push chunk, will retry after 2s...");
          await sleep(2000);
          await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:I',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: chunk },
          });
        }
      }

      const linkHeader = response.headers.link;
      nextUrl = null;
      if (linkHeader) {
        const links = linkHeader.split(',');
        for (const link of links) {
          if (link.includes('rel="next"')) {
            const match = link.match(/<([^>]+)>/);
            if (match) nextUrl = match[1];
          }
        }
      }

      page++;
      await sleep(1500); // Respect Shopify & Google limits
    }

    console.log('SUCCESS! All pages finished downloading and pushing!');
    process.exit(0);
  } catch (error) {
    console.error('Error during live push bulk sync:', error.message);
    if(error.response) console.error(JSON.stringify(error.response.data));
    process.exit(1);
  }
}

syncAll();
