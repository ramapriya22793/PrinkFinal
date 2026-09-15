const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Order = require('../models/Order');

async function seed() {
  await mongoose.connect('mongodb://127.0.0.1:63116/theprink');
  console.log('Connected to running MongoMemoryServer');

  const captions = [
    "U know who I'm looking!",
    "That one memorable trip",
    "Silly girl. LOL!!",
    "PC: Husband",

    "Picture perfect",
    "Panda Kutti",
    "A big huggie!",
    "My dear Buddha",

    "Sachin who?",
    "",
    "Love you, always.",
    "idk why I like it very much!!",

    "Praise the lord!",
    "Cringe couples ah!",
    "Bas Kuch bhi.",
    "Meri jaan",

    "Our 1st trip",
    "Best couples",
    "How to work on ur poses sumu!",
    "My personal fav"
  ];

  const photoMapping = [
    20, 19, 18, 17,
    16, 15, 14, 13,
    12, 11, 10, 9,
    8,  7,  6,  5,
    4,  3,  2,  1
  ];

  const images = [];
  for (let i = 0; i < 20; i++) {
    const num = photoMapping[i];
    const filename = `polaroid_photo_${num}.jpg`;
    images.push({
      id: `img_${i + 1}`,
      url: `/uploads/polaroid_20_sample/${filename}`,
      src: `/uploads/polaroid_20_sample/${filename}`,
      serverFilename: filename,
      caption: captions[i],
      rotation: 0,
      brightness: 100,
      contrast: 100
    });
  }

  const pdfUrl = '/uploads/print/POLAROID_186632-1_FINAL.pdf';
  const printFiles = [{
    url: pdfUrl,
    filename: 'POLAROID_186632-1_FINAL.pdf',
    dpi: 300,
    effectiveDpi: 300,
    widthMm: 319.148,
    heightMm: 498.900,
    colourSpace: 'RGB',
    isPolaroid: true
  }];

  const orderDoc = {
    id: '186632-17473268809957',
    orderNumber: '186632-1',
    shopifyId: '7364101996773',
    customer: {
      id: 'CUST-186632-17473268809957',
      name: 'Naveen Kumar',
      email: 'naveen.tzp@gmail.com',
      phone: '9445288525'
    },
    customerEmail: 'naveen.tzp@gmail.com',
    shippingAddress: {
      address1: 'Flat no 272, C2 Block, 11th floor',
      city: 'Chennai',
      country: 'India',
      zip: '600001'
    },
    product: 'Polaroid Photo Print',
    productType: 'polaroid',
    sku: 'PG-PP-20-02',
    quantity: 1,
    templateId: 'tpl-polaroid-20',
    orderStatus: 'Print Ready',
    workflowStatus: 'approved',
    uploadStatus: 'ready',
    customizationStatus: 'completed',
    adminApprovalStatus: 'approved',
    printStatus: 'queued',
    printGenerationStatus: 'completed',
    pdfUrl,
    printFiles,
    images,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await Order.findOneAndUpdate(
    { id: orderDoc.id },
    { $set: orderDoc },
    { upsert: true, returnDocument: 'after' }
  );

  // Also create alias with id '186632' so both work
  const orderDocAlias = { ...orderDoc, id: '186632' };
  await Order.findOneAndUpdate(
    { id: '186632' },
    { $set: orderDocAlias },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('Seeded Order 186632 & 186632-17473268809957 into running database!');
  process.exit(0);
}

seed().catch(e => {
  console.error(e);
  process.exit(1);
});
