const fs = require('fs');

const path = 'server/routes/order.routes.js';
let content = fs.readFileSync(path, 'utf8');

// Add import
const importStatement = `const { allocateButterflyTemplate } = require('../services/butterflyAllocation.service');\n`;
content = content.replace("const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');", "const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');\n" + importStatement);

// Replace block in force-approve
const targetContent = `
      if (isButterfly) {
        try {
          const file = await generateButterflyBoxPdf({ orderId: order.id, images: order.images || [], order });
          printFiles.push({ ...file, isButterfly: true });
        } catch (err) {
          console.error('[FORCE APPROVE RENDER ERROR]', id, err.message);
        }
      } else if (isMagazine) {
`;

const replacementContent = `
      let extraUpdateData = {};
      if (isButterfly) {
        try {
          const result = await allocateButterflyTemplate(order, order.images || []);
          if (result.generated) {
            printFiles.push(...result.printFiles);
          }
          extraUpdateData = {
            templateId: result.templateId,
            templateSide: result.templateSide,
            linkedOrderId: result.linkedOrderId,
            printGenerationStatus: result.generated ? 'completed' : 'pending'
          };
        } catch (err) {
          console.error('[FORCE APPROVE BUTTERFLY ALLOCATION ERROR]', id, err.message);
        }
      } else if (isMagazine) {
`;

content = content.replace(targetContent, replacementContent);

// Add extraUpdateData to updateData
const updateDataTarget = `
    const updateData = {
      designLockedAt: order.designLockedAt || new Date(),
      customizationStatus: 'completed',
`;

const updateDataReplacement = `
    const updateData = {
      designLockedAt: order.designLockedAt || new Date(),
      customizationStatus: 'completed',
      ...extraUpdateData,
`;
content = content.replace(updateDataTarget, updateDataReplacement);

fs.writeFileSync(path, content, 'utf8');
console.log('Updated order.routes.js');
