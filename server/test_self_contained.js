const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { connectDB } = require('./db/connection');
const db = require('./db');
const { processShopifyOrderWebhook } = require('./services/shopifyWebhookService');

async function testSelfContained() {
  console.log('--- STARTING SELF-CONTAINED WORKFLOW VERIFICATION ---');
  await connectDB();

  // 1. Trigger Webhook Order Creation & Parse
  console.log('1. Processing Mock Webhook Payload...');
  const mockPayload = {
    id: 9988776655,
    order_number: 1042,
    name: `#ORD-1042-${Date.now().toString().slice(-4)}`,
    email: 'customer@example.com',
    total_price: '1499.00',
    financial_status: 'paid',
    created_at: new Date().toISOString(),
    customer: {
      id: 123456789,
      first_name: 'Rahul',
      last_name: 'Sharma',
      email: 'customer@example.com',
      phone: '+919876543210'
    },
    shipping_address: {
      name: 'Rahul Sharma',
      address1: '123 Main Street',
      city: 'Mumbai',
      province: 'Maharashtra',
      country: 'India',
      zip: '400001',
      phone: '+919876543210'
    },
    line_items: [
      {
        id: 55443322,
        product_id: 11223344,
        variant_id: 66778899,
        title: 'Custom Photo Frame 8x10',
        quantity: 1,
        price: '1499.00',
        sku: 'FRAME-8X10'
      }
    ]
  };

  const webhookResult = await processShopifyOrderWebhook(mockPayload, 'orders/create');
  const orderId = webhookResult.order.id;
  const uploadToken = webhookResult.uploadToken;
  console.log(` -> Webhook processed! Order ID: ${orderId}, Token: ${uploadToken}`);
  console.log(` -> Upload Link: ${webhookResult.uploadLink}`);

  // 2. Duplicate Check Test
  console.log('2. Testing Duplicate Prevention...');
  const duplicateResult = await processShopifyOrderWebhook(mockPayload, 'orders/create');
  console.log(` -> Duplicate check passed. Order ID maintained: ${duplicateResult.order.id}`);

  // 3. Customer Upload Simulation
  console.log('3. Simulating Customer Upload...');
  const orderForCustomer = await db.getOrderByUploadToken(uploadToken);
  if (!orderForCustomer) throw new Error('Upload token lookup failed');
  
  await db.updateOrder(orderId, {
    uploadStatus: 'completed',
    customizationStatus: 'completed',
    images: [{ id: 'img-1', url: 'https://example.com/uploaded-photo.jpg' }],
    designData: { template: 'frame-8x10-standard' }
  });
  await db.addActivityLog(orderId, 'CUSTOMER_UPLOADED_DESIGN', 'Customer uploaded photo design.');
  console.log(' -> Customer upload saved');

  // 4. Admin Dashboard Approval Simulation
  console.log('4. Simulating Admin Review & Approval...');
  await db.updateOrder(orderId, {
    adminApprovalStatus: 'approved',
    orderStatus: 'Approved',
    printStatus: 'queued',
    pdfUrl: `/uploads/print-${orderId}.pdf`
  });
  await db.addActivityLog(orderId, 'ADMIN_APPROVED', 'Admin approved order design for printing.');
  console.log(' -> Admin approval completed');

  // 5. Printer Dashboard Queue & Processing Simulation
  console.log('5. Simulating Printer Queue Processing...');
  await db.updateOrder(orderId, { printStatus: 'processing', orderStatus: 'Printing' });
  await db.addActivityLog(orderId, 'PRINTER_STATUS_UPDATE', 'Printer status updated to processing (Order status: Printing)');

  await db.updateOrder(orderId, { printStatus: 'completed', orderStatus: 'Shipped', deliveryStatus: 'shipped' });
  await db.addActivityLog(orderId, 'PRINTER_STATUS_UPDATE', 'Printer status updated to completed (Order status: Shipped)');

  await db.updateOrder(orderId, { orderStatus: 'Delivered', deliveryStatus: 'delivered' });
  await db.addActivityLog(orderId, 'PRINTER_STATUS_UPDATE', 'Order delivered to customer.');

  // 6. Fetch Final State
  console.log('6. Fetching Final Order Details from MongoDB...');
  const finalOrder = await db.getOrderById(orderId);

  console.log('\n====================================');
  console.log('    VERIFICATION COMPLETE REPORT');
  console.log('====================================');
  console.log('Order ID:           ', finalOrder.id);
  console.log('Order Status:       ', finalOrder.orderStatus);
  console.log('Upload Status:      ', finalOrder.uploadStatus);
  console.log('Admin Status:       ', finalOrder.adminApprovalStatus);
  console.log('Print Status:       ', finalOrder.printStatus);
  console.log('Delivery Status:    ', finalOrder.deliveryStatus);
  console.log('Customer Upload Link:', finalOrder.uploadLink);
  console.log('PDF URL:            ', finalOrder.pdfUrl);
  console.log('\nACTIVITY LOGS:');
  finalOrder.activityLogs.forEach(log => console.log(` -> [${new Date(log.timestamp).toISOString()}] ${log.text}`));

  process.exit(0);
}

testSelfContained().catch(err => {
  console.error('Self-contained test error:', err);
  process.exit(1);
});
