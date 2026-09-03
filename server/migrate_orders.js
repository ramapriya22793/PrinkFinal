const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/theprink').then(async () => {
  const ShopifyOrder = mongoose.model('ShopifyOrder', new mongoose.Schema({}, { strict: false }));
  const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
  
  const list = await ShopifyOrder.find({});
  console.log(`Copying ${list.length} orders...`);
  
  for (const o of list) {
    const raw = o.rawJson;
    if (!raw) continue;
    const lineItems = raw.line_items || [];
    for (const item of lineItems) {
      const portalOrderId = `${raw.name || '#' + raw.order_number}-${item.id}`;
      
      let pType = 'canvas';
      const titleLower = item.title.toLowerCase();
      if (titleLower.includes('mug')) pType = 'mug';
      else if (titleLower.includes('frame')) pType = 'frame';
      else if (titleLower.includes('calendar')) pType = 'calendar';
      else if (titleLower.includes('book')) pType = 'photobook';
      
      let customerName = 'Shopify Customer';
      if (raw.customer) {
        customerName = `${raw.customer.first_name || ''} ${raw.customer.last_name || ''}`.trim() || customerName;
      }
      
      const doc = {
        id: portalOrderId,
        shopifyId: String(raw.id),
        customer: customerName,
        product: item.title,
        productType: pType,
        sku: item.sku || '',
        quantity: item.quantity,
        date: new Date(raw.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }),
        phone: raw.customer?.phone || raw.shipping_address?.phone || '',
        email: raw.email || raw.customer?.email || '',
        shippingAddress: raw.shipping_address,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()
      };
      
      await Order.findOneAndUpdate(
        { id: portalOrderId },
        { $set: doc },
        { upsert: true }
      );
    }
  }
  console.log('Copy complete!');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
