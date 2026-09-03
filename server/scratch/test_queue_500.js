const mongoose = require('mongoose');
const Order = require('../models/Order');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/theprink').then(async () => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    console.log(`Found ${orders.length} orders.`);
    
    const DASHBOARD_STATUS = {
      'print-ready': 'print-ready',
      ready:         'print-ready',
      processing:    'printing',
      printing:      'printing',
      completed:     'completed'
    };

    const mapped = orders.map(o => {
      try {
        const file = (o.printFiles || []).filter(Boolean)[0];
        const ws = o.workflowStatus;
        let dashStatus = DASHBOARD_STATUS[o.printStatus] || 'pending';
        if (ws === 'sent_to_printer') dashStatus = 'pending';
        else if (ws === 'printer_processing') dashStatus = 'processing';
        else if (ws === 'completed') dashStatus = 'completed';
        
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          customer: o.customer?.name || o.customer?.email || (typeof o.customer === 'string' ? o.customer : 'Guest'),
          customerEmail: o.customerEmail || o.email || o.customer?.email,
          phone: o.phone || o.customer?.phone,
          product: o.product,
          sku: o.sku,
          quantity: o.quantity,
          templateId: o.templateId,
          status: dashStatus,
          printStatus: o.printStatus,
          workflowStatus: o.workflowStatus,
          orderStatus: o.orderStatus,
          priority: o.priority || 'normal',
          images: o.images || [],
          pdfUrl: o.pdfUrl,
          shippingAddress: o.shippingAddress,
          deliveryTemplate: o.deliveryTemplate,
          customizationStatus: o.customizationStatus,
          uploadStatus: o.uploadStatus,
          trimSize: (file && file.widthMm && file.heightMm) ? `${Math.round(file.widthMm)}x${Math.round(file.heightMm)}mm` : '-',
          assignedAt: o.printerAssignedAt || o.updatedAt,
          printFiles: (o.printFiles || []).filter(Boolean).map(f => ({
            url: f.url, dpi: f.dpi, effectiveDpi: f.effectiveDpi,
            widthMm: f.widthMm, heightMm: f.heightMm, colourSpace: f.colourSpace
          })),
          updatedAt: o.updatedAt
        };
      } catch (innerErr) {
        console.error('Error on order id:', o.id, innerErr);
        throw innerErr;
      }
    });
    console.log('Mapping succeeded!');
  } catch (err) {
    console.error('Execution failed:', err);
  } finally {
    process.exit(0);
  }
});
