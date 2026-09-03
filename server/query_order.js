const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/theprink').then(async () => {
  const docs = await mongoose.connection.db.collection('orders').find({
    $or: [
      { id: /171775154/ },
      { shopifyId: /171775154/ }
    ]
  }).toArray();
  console.log(JSON.stringify(docs, null, 2));
  process.exit(0);
});
