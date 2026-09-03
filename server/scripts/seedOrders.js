const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI is not set. Configure server/.env before running this script.');
  process.exit(1);
}

const financialStatuses = ['PAID', 'PENDING', 'PARTIALLY_PAID', 'REFUNDED'];
const fulfillmentStatuses = ['UNFULFILLED', 'READY_FOR_PRINT', 'PRINTING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const paymentMethods = ['Credit Card', 'UPI', 'Net Banking', 'Cash on Delivery'];

async function seedOrders() {
  const conn = await mongoose.createConnection(URI).asPromise();
  console.log('Connected to MongoDB for Orders seeding.');
  const db = conn.db;

  const customers = await db.collection('customers').find({}).toArray();
  const products = await db.collection('products').find({}).toArray();

  if (customers.length === 0 || products.length === 0) {
    console.error('Customers or Products missing. Run seedCustomers and seedProducts first.');
    await conn.close();
    return;
  }

  // Find the 5 specific login-capable customers to ensure they get plenty of orders
  const loginCustomers = customers.slice(0, 5);
  
  const orders = [];
  
  for (let i = 0; i < 150; i++) {
    // 30% chance to assign to one of our 5 specific login customers so they look active
    let customer;
    if (Math.random() < 0.3) {
      customer = loginCustomers[Math.floor(Math.random() * loginCustomers.length)];
    } else {
      customer = customers[Math.floor(Math.random() * customers.length)];
    }

    const orderNumber = `#${1001 + i}`;
    const numLineItems = Math.floor(Math.random() * 4) + 1; // 1 to 4 items
    const lineItems = [];
    let subtotal = 0;

    for (let j = 0; j < numLineItems; j++) {
      const product = products[Math.floor(Math.random() * products.length)];
      const qty = Math.floor(Math.random() * 3) + 1;
      const unitPrice = product.price;
      const totalLinePrice = unitPrice * qty;
      subtotal += totalLinePrice;
      
      const orderIdStr = orderNumber.replace('#', '');
      
      lineItems.push({
        productId: product._id,
        sku: product.sku,
        productName: product.title,
        quantity: qty,
        unitPrice: unitPrice,
        totalPrice: totalLinePrice,
        uploadedImages: [
          `uploads/customer/order${orderIdStr}/image1.jpg`,
          ...(Math.random() > 0.5 ? [`uploads/customer/order${orderIdStr}/image2.jpg`] : [])
        ],
        previewImage: `previews/order${orderIdStr}/${product.category.replace(/\s+/g, '-').toLowerCase()}-preview.png`,
        personalizationStatus: ['Pending', 'In Progress', 'Completed'][Math.floor(Math.random() * 3)]
      });
    }

    const tax = Math.round(subtotal * 0.18); // 18% GST
    const shipping = subtotal > 1500 ? 0 : 100;
    const discount = Math.random() > 0.7 ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal + tax + shipping - discount;
    const orderDate = new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)); // Last 30 days
    const expectedDelivery = new Date(orderDate.getTime() + (7 * 24 * 60 * 60 * 1000)); // +7 days

    const order = {
      _id: new mongoose.Types.ObjectId(),
      id: orderNumber,
      shopifyOrderId: `gid://shopify/Order/${5000000000 + i}`,
      orderNumber: orderNumber,
      customerId: customer._id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      customerEmail: customer.email,
      phone: customer.phone, // Adding phone since our UI links by phone!
      financialStatus: financialStatuses[Math.floor(Math.random() * financialStatuses.length)],
      fulfillmentStatus: fulfillmentStatuses[Math.floor(Math.random() * fulfillmentStatuses.length)],
      paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      subtotal,
      shipping,
      tax,
      discount,
      total,
      currency: 'INR',
      orderDate,
      expectedDelivery,
      shippingAddress: {
        address1: customer.defaultAddress,
        city: customer.city,
        state: customer.state,
        country: customer.country,
        postalCode: customer.postalCode
      },
      billingAddress: {
        address1: customer.defaultAddress,
        city: customer.city,
        state: customer.state,
        country: customer.country,
        postalCode: customer.postalCode
      },
      lineItems
    };

    orders.push(order);
  }

  const ordersCollection = db.collection('orders');
  await ordersCollection.deleteMany({});
  await ordersCollection.insertMany(orders);
  
  console.log(`Inserted ${orders.length} orders into 'orders' collection.`);

  // Also insert the most recent 15 orders into our backend Mongoose `Order` schema for the UI
  // Note: The Mongoose `Order` model maps to `orders` collection, but requires specific fields.
  // We'll augment the top 20 orders so they show up beautifully in the Customer Portal UI.
  for (let i = 0; i < 20; i++) {
    const o = orders[orders.length - 1 - i]; // get recent
    const firstItem = o.lineItems[0];
    
    let pType = 'canvas';
    const titleLower = firstItem.productName.toLowerCase();
    if (titleLower.includes('mug')) pType = 'mug';
    else if (titleLower.includes('frame')) pType = 'frame';
    else if (titleLower.includes('calendar')) pType = 'calendar';
    else if (titleLower.includes('book')) pType = 'photobook';
    else if (titleLower.includes('t-shirt') || titleLower.includes('tshirt')) pType = 'tshirt';
    else if (titleLower.includes('pillow') || titleLower.includes('cushion')) pType = 'pillow';
    else if (titleLower.includes('case')) pType = 'mobilecase';

    const matchedProd = products.find(p => String(p._id) === String(firstItem.productId));
    const pImg = matchedProd ? matchedProd.image : '';

    const uiOrder = {
      id: o.orderNumber.replace('#', ''),
      shopifyId: o.orderNumber.replace('#', ''),
      orderNumber: o.orderNumber.replace('#', ''),
      customer: {
        id: String(o.customerId),
        name: o.customerName,
        email: o.customerEmail,
        phone: o.phone
      },
      product: firstItem.productName,
      productType: pType,
      productImage: pImg,
      sku: firstItem.sku,
      quantity: firstItem.quantity,
      phone: o.phone,
      date: o.orderDate.toDateString(),
      uploadStatus: 'ready',
      customizationStatus: firstItem.personalizationStatus.toLowerCase().replace(' ', '-'),
      deliveryStatus: o.fulfillmentStatus === 'DELIVERED' ? 'delivered' : (o.fulfillmentStatus === 'SHIPPED' ? 'shipped' : 'pending'),
      dpiStatus: 'ok',
      images: [ { id: 'img1', url: firstItem.uploadedImages[0], name: 'image1.jpg' } ]
    };
    await ordersCollection.updateOne({ orderNumber: o.orderNumber }, { $set: uiOrder });
  }

  await conn.close();
  return orders;
}

if (require.main === module) {
  seedOrders().catch(console.error);
}

module.exports = seedOrders;


