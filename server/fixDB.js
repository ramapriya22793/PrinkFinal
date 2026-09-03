const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/theprink').then(async () => {
  try {
    await mongoose.connection.collection('butterflytemplates').dropIndex('templateId_1');
    console.log('Dropped templateId_1 index');
  } catch (e) {
    console.log('Index might not exist:', e.message);
  }
  
  await mongoose.connection.collection('butterflytemplates').deleteMany({});
  await mongoose.connection.collection('butterflytemplateslots').deleteMany({});
  console.log('Cleared collections');
  
  const Order = require('./models/Order');
  const { allocateButterflyTemplate } = require('./services/butterflyAllocation.service');
  
  const o1 = await Order.findOne({ id: '170564-15908206182629' });
  if (o1) {
    console.log('Allocating O1...');
    const res1 = await allocateButterflyTemplate(o1, o1.images);
    await Order.updateOne({ id: o1.id }, {
      $set: {
        templateId: res1.templateId,
        templateSide: res1.templateSide,
        linkedOrderId: res1.linkedOrderId,
        printFiles: res1.printFiles,
        pdfUrl: res1.generated && res1.printFiles.length ? res1.printFiles[0].url : null,
        printGenerationStatus: res1.generated ? 'completed' : 'pending',
      }
    });
  }

  const o2 = await Order.findOne({ id: '170569-15908393222373' });
  if (o2) {
    console.log('Allocating O2...');
    const res2 = await allocateButterflyTemplate(o2, o2.images);
    await Order.updateOne({ id: o2.id }, {
      $set: {
        templateId: res2.templateId,
        templateSide: res2.templateSide,
        linkedOrderId: res2.linkedOrderId,
        printFiles: res2.printFiles,
        pdfUrl: res2.generated && res2.printFiles.length ? res2.printFiles[0].url : null,
        printGenerationStatus: res2.generated ? 'completed' : 'pending',
      }
    });
  }
  
  console.log('Done!');
  mongoose.disconnect();
});
