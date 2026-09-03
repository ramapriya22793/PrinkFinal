const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/theprink').then(async () => {
  const docs = await mongoose.connection.db.collection('orders').find().toArray();
  for (const doc of docs) {
    console.log({
      id: doc.id,
      product: doc.product,
      productImage: doc.productImage,
      variant: doc.variant
    });
  }
  process.exit(0);
});
