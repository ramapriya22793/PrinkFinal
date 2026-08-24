const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI is not set. Configure server/.env before running this script.');
  process.exit(1);
}

async function seedProducts() {
  const conn = await mongoose.createConnection(URI).asPromise();
  console.log('Connected to MongoDB.');

  const db = conn.db;

  const productNames = [
    'Premium Ceramic Coffee Mug Wrap',
    'Magic Color Changing Mug',
    'Custom White T-Shirt',
    'Custom Black T-Shirt',
    'Mouse Pad',
    'Photo Frame',
    'Keychain',
    'Notebook',
    'Water Bottle',
    'Canvas Print',
    'Laptop Skin',
    'Mobile Case',
    'Puzzle',
    'Calendar',
    'Desk Clock',
    'Photo Cushion',
    'Acrylic Photo Frame',
    'Bottle Opener',
    'Coaster',
    'Photo Slate'
  ];

  const products = productNames.map((name, i) => {
    return {
      _id: new mongoose.Types.ObjectId(),
      shopifyProductId: `gid://shopify/Product/${8000000000 + i}`,
      title: name,
      sku: `PRK-${name.substring(0, 3).toUpperCase()}-${1000 + i}`,
      category: 'Personalized Gifts',
      vendor: 'Prink',
      description: `High-quality customizable ${name.toLowerCase()}. Perfect for gifting!`,
      price: Math.floor(Math.random() * 1500) + 200,
      compareAtPrice: Math.floor(Math.random() * 2000) + 1800,
      inventoryQuantity: Math.floor(Math.random() * 500) + 50,
      currency: 'INR',
      image: `https://prink-in.myshopify.com/cdn/shop/files/${name.replace(/\s+/g, '-').toLowerCase()}.jpg`,
      status: 'active',
      createdAt: new Date()
    };
  });

  const productsCollection = db.collection('products');
  await productsCollection.deleteMany({});
  await productsCollection.insertMany(products);
  
  console.log(`Inserted ${products.length} products into 'products' collection.`);

  await conn.close();
  return products;
}

if (require.main === module) {
  seedProducts().catch(console.error);
}

module.exports = seedProducts;


