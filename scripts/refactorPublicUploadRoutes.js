const fs = require('fs');

const file = 'server/routes/publicUpload.routes.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `
    if (isButterfly) {
      const session = await mongoose.startSession();
      session.startTransaction();
      
      let printFiles = [];
      let generated = false;
      let templateSide = 'BLUE';
      let butterflyTemplateId = null;
      let linkedOrderId = null;

      try {
        let template = await ButterflyTemplate.findOneAndUpdate(
`;

const endStr = `      res.json({
        success: true,
        confirmed: true,
        printFiles: printFiles.map(f => ({ url: f.url })),
        failures: []
      });
      return;
    }`;

const startIdx = content.indexOf('    if (isButterfly) {');
const endIdx = content.indexOf(endStr) + endStr.length;

if (startIdx === -1 || content.indexOf(endStr) === -1) {
  console.log('Could not find boundaries');
  process.exit(1);
}

const replacement = `
    if (isButterfly) {
      try {
        const { allocateButterflyTemplate } = require('../services/butterflyAllocation.service');
        const result = await allocateButterflyTemplate(claim, images);
        
        await Order.updateOne({ id: order.id }, {
          $set: {
            templateId: result.templateId,
            templateSide: result.templateSide,
            linkedOrderId: result.linkedOrderId,
            printFiles: result.printFiles,
            pdfUrl: result.generated && result.printFiles.length ? result.printFiles[0].url : null,
            printGenerationStatus: result.generated ? 'completed' : 'pending',
            adminApprovalStatus: 'pending',
            orderStatus: 'Pending'
          }
        });

        res.json({
          success: true,
          confirmed: true,
          printFiles: result.printFiles.map(f => ({ url: f.url })),
          failures: []
        });
        return;
      } catch (err) {
        console.error('[BUTTERFLY ALLOCATION ERROR]', err);
        throw err;
      }
    }
`;

content = content.slice(0, startIdx) + replacement.trim() + '\n\n' + content.slice(endIdx);
fs.writeFileSync(file, content);
console.log('Refactored publicUpload.routes.js successfully!');
