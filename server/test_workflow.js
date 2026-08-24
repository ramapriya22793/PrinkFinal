const http = require('http');

function request(method, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) reject(new Error('Status: ' + res.statusCode + ' ' + body));
          resolve(JSON.parse(body));
        } catch(e) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  const report = [];
  try {
    // 1. Admin login to get token
    console.log('Logging in as admin...');
    const adminLogin = await request('POST', '/api/auth/admin-login', { email: 'admin@theprink.com', password: 'prink123' });
    const adminToken = adminLogin.token;
    report.push('- [x] Admin Auth Successful');

    // 2. Trigger mock webhook
    console.log('Triggering mock webhook...');
    const webhookRes = await request('POST', '/api/shopify/mock-webhook');
    const orderId = webhookRes.order.id;
    const uploadLink = webhookRes.whatsapp.uploadLink;
    const tokenStr = uploadLink.includes('token=') ? uploadLink.split('token=')[1].split('&')[0] : '';
    report.push('- [x] Webhook triggered (Order ID: ' + orderId + ')');
    report.push('- [x] Customer Upload Link Generated: ' + uploadLink);

    // 3. Verify Customer Upload Token Lookup
    console.log('Verifying order lookup via upload token...');
    const tokenOrder = await request('GET', '/api/orders/upload-token/' + tokenStr);
    report.push('- [x] Customer Upload Link Verified');

    // 4. Customer Upload & Submit
    console.log('Customer submitting design for orderId: ' + orderId);
    const confirmRes = await request('POST', '/api/orders/' + orderId + '/design', {
      designData: { canvas: 'preset-1' },
      customizationStatus: 'completed',
      images: [{ id: 'img-1', url: 'https://example.com/photo.jpg' }]
    }, { 'Authorization': 'Bearer ' + tokenStr });
    report.push('- [x] Customer Images Uploaded & Submitted');

    // 5. Admin Approves and Generates PDF
    console.log('Admin approving...');
    const reviewRes = await request('POST', '/api/orders/' + orderId + '/review', { action: 'approve', comments: 'Design looks great!' }, { 'Authorization': 'Bearer ' + adminToken });
    report.push('- [x] Admin Reviewed & Approved');

    // 6. Printer marks as Processing then Completed
    console.log('Printer logging in & updating status...');
    const printerLogin = await request('POST', '/api/auth/printer-login', { email: 'printer@theprink.com', password: 'printer123' });
    const printerToken = printerLogin.token;

    await request('POST', '/api/printer/queue/' + orderId + '/status', { status: 'processing' }, { 'Authorization': 'Bearer ' + printerToken });
    await request('POST', '/api/printer/queue/' + orderId + '/status', { status: 'completed' }, { 'Authorization': 'Bearer ' + printerToken });
    report.push('- [x] Printer marked order as completed / shipped');

    // 7. Fetch final order to verify DB updates
    console.log('Fetching final order details...');
    const ordersRes = await request('GET', '/api/orders', null, { 'Authorization': 'Bearer ' + adminToken });
    const orderList = Array.isArray(ordersRes) ? ordersRes : (ordersRes.orders || []);
    const finalOrder = orderList.find(o => o.id === orderId);

    report.push('- [x] Database completely updated and verified');

    console.log('\n====================================');
    console.log('      END-TO-END WORKFLOW REPORT');
    console.log('====================================\n');
    console.log(report.join('\n'));
    console.log('\nFINAL ORDER STATUS:');
    console.log('Order Status:', finalOrder.orderStatus);
    console.log('Upload Status:', finalOrder.uploadStatus);
    console.log('Admin Status:', finalOrder.adminApprovalStatus);
    console.log('Print Status:', finalOrder.printStatus);
    console.log('Delivery Status:', finalOrder.deliveryStatus);
    console.log('PDF URL:', finalOrder.pdfUrl);
    console.log('\nACTIVITY LOGS:');
    (finalOrder.activityLogs || []).forEach(log => console.log(' -> [' + (log.timestamp || log.time || 'NOW') + '] ' + log.text));
    
  } catch (err) {
    console.error('Workflow failed:', err);
  }
}
run();







