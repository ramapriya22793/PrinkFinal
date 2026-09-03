const fs = require('fs');

const path = 'server/routes/publicUpload.routes.js';
let content = fs.readFileSync(path, 'utf8');

// Add imports
const imports = `
const mongoose = require('mongoose');
const ButterflyTemplate = require('../models/ButterflyTemplate');
const ButterflyTemplateSlot = require('../models/ButterflyTemplateSlot');
const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
`;
content = content.replace("const Order = require('../models/Order');", "const Order = require('../models/Order');\n" + imports.trim());

// Find the block in /order/:token/confirm
const targetContent = `
    await db.addActivityLog(order.id, 'CUSTOMER_APPROVED', 'Customer confirmed the design.');
    console.log(\`[WORKFLOW LOG] STEP 10 - Customer Submitted Design. Order \${order.id} is now LOCKED.\`);

    const template = await templateForOrder(claim);
    const printFiles = [];
    const failures = [];

    for (const img of images) {
      try {
        const result = await generatePrintPdf({
          orderId: claim.id,
          order: claim,
          image: img,
          template,
          transform: img.transform || fromLegacyImage(img)
        });
        printFiles.push({ ...result, imageId: img.id });
      } catch (err) {
        console.error('[PRINT RENDER ERROR]', claim.id, img.id, err.message);
        failures.push({ imageId: img.id, error: err.message });
      }
    }

    const generated = printFiles.length > 0;
    await Order.updateOne({ id: order.id }, {
      $set: {
        printFiles,
        templateId: template.id,
        pdfUrl: generated ? printFiles[0].url : null,
        printGenerationStatus: failures.length === 0 ? 'completed' : (generated ? 'partial' : 'failed'),
        printGenerationErrors: failures,
        adminApprovalStatus: 'pending',
        orderStatus: 'Pending'
      }
    });

    await db.addActivityLog(
      order.id,
      generated ? 'PDF_GENERATED' : 'PDF_FAILED',
      generated
        ? \`Print file generated (\${printFiles.length} of \${images.length}) using template \${template.id}.\`
        : \`Print file generation failed: \${failures.map(f => f.error).join('; ')}\`
    );
    console.log(\`[WORKFLOW LOG] STEP 9 - Print PDF Generated for Order \${order.id}: \${generated ? 'SUCCESS' : 'FAILED'}\`);

    res.json({
      success: true,
      confirmed: true,
      printFiles: printFiles.map(f => ({ url: f.url, dpi: f.dpi, effectiveDpi: f.effectiveDpi, widthMm: f.widthMm, heightMm: f.heightMm })),
      failures
    });
`;

const newLogic = `
    await db.addActivityLog(order.id, 'CUSTOMER_APPROVED', 'Customer confirmed the design.');
    console.log(\`[WORKFLOW LOG] STEP 10 - Customer Submitted Design. Order \${order.id} is now LOCKED.\`);

    const isButterfly = (claim.productType || '').toLowerCase() === 'butterfly' || (claim.product || '').toLowerCase().includes('butterfly');
    
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
          { status: 'WAITING_FOR_SECOND_CUSTOMER' },
          { $set: { status: 'READY_FOR_PRINT' } },
          { sort: { createdAt: 1 }, session, new: true }
        );

        if (template) {
          // Found an existing template, we take the RED slot
          templateSide = 'RED';
          butterflyTemplateId = template.id;

          const slot = new ButterflyTemplateSlot({
            id: crypto.randomUUID(),
            templateId: template.id,
            side: 'RED',
            orderId: claim.id,
            customerId: claim.customer?.id || 'unknown'
          });
          await slot.save({ session });

          // Find the BLUE order to link and render
          const blueSlot = await ButterflyTemplateSlot.findOne({ templateId: template.id, side: 'BLUE' }).session(session);
          if (blueSlot) {
            linkedOrderId = blueSlot.orderId;
            
            // Link the old order to this new one
            await Order.updateOne({ id: linkedOrderId }, { $set: { linkedOrderId: claim.id } }, { session });
            
            // Generate the shared PDF
            const blueOrder = await Order.findOne({ id: linkedOrderId }).session(session);
            
            if (blueOrder && blueOrder.images && blueOrder.images.length >= 8) {
              const file = await generateButterflyBoxPdf({
                orderId: blueOrder.id,
                images: blueOrder.images,
                order: blueOrder,
                orderId2: claim.id,
                images2: images,
                order2: claim,
                templateId: template.id
              });
              
              const pdfMeta = { ...file, isButterfly: true };
              
              // Update BOTH orders with the new print file
              await Order.updateOne({ id: linkedOrderId }, { 
                $set: { 
                  printFiles: [pdfMeta], 
                  pdfUrl: pdfMeta.url,
                  printGenerationStatus: 'completed'
                } 
              }, { session });
              
              printFiles = [pdfMeta];
              generated = true;
            }
          }
        } else {
          // No existing template, create a new one
          template = new ButterflyTemplate({
            id: crypto.randomUUID(),
            templateNumber: Date.now(),
            status: 'WAITING_FOR_SECOND_CUSTOMER'
          });
          await template.save({ session });
          
          butterflyTemplateId = template.id;
          templateSide = 'BLUE';
          
          const slot = new ButterflyTemplateSlot({
            id: crypto.randomUUID(),
            templateId: template.id,
            side: 'BLUE',
            orderId: claim.id,
            customerId: claim.customer?.id || 'unknown'
          });
          await slot.save({ session });
        }

        await Order.updateOne({ id: order.id }, {
          $set: {
            templateId: butterflyTemplateId,
            templateSide,
            linkedOrderId,
            printFiles,
            pdfUrl: generated ? printFiles[0].url : null,
            printGenerationStatus: generated ? 'completed' : 'pending',
            adminApprovalStatus: 'pending',
            orderStatus: 'Pending'
          }
        }, { session });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        console.error('[BUTTERFLY ALLOCATION ERROR]', err);
        // Fallback to normal behavior on error or just fail
        throw err;
      } finally {
        session.endSession();
      }

      await db.addActivityLog(
        order.id,
        'BUTTERFLY_ALLOCATED',
        \`Assigned to Butterfly Template \${butterflyTemplateId} on the \${templateSide} side.\`
      );
      
      if (generated) {
        await db.addActivityLog(
          order.id,
          'PDF_GENERATED',
          \`Shared Butterfly Print generated using template \${butterflyTemplateId}.\`
        );
        if (linkedOrderId) {
           await db.addActivityLog(
            linkedOrderId,
            'PDF_GENERATED',
            \`Shared Butterfly Print generated using template \${butterflyTemplateId}.\`
          );
        }
      }

      res.json({
        success: true,
        confirmed: true,
        printFiles: printFiles.map(f => ({ url: f.url })),
        failures: []
      });
      return;
    }

    // Existing Workflow for NON-Butterfly Box
    const template = await templateForOrder(claim);
    const printFiles = [];
    const failures = [];

    for (const img of images) {
      try {
        const result = await generatePrintPdf({
          orderId: claim.id,
          order: claim,
          image: img,
          template,
          transform: img.transform || fromLegacyImage(img)
        });
        printFiles.push({ ...result, imageId: img.id });
      } catch (err) {
        console.error('[PRINT RENDER ERROR]', claim.id, img.id, err.message);
        failures.push({ imageId: img.id, error: err.message });
      }
    }

    const generated = printFiles.length > 0;
    await Order.updateOne({ id: order.id }, {
      $set: {
        printFiles,
        templateId: template.id,
        pdfUrl: generated ? printFiles[0].url : null,
        printGenerationStatus: failures.length === 0 ? 'completed' : (generated ? 'partial' : 'failed'),
        printGenerationErrors: failures,
        adminApprovalStatus: 'pending',
        orderStatus: 'Pending'
      }
    });

    await db.addActivityLog(
      order.id,
      generated ? 'PDF_GENERATED' : 'PDF_FAILED',
      generated
        ? \`Print file generated (\${printFiles.length} of \${images.length}) using template \${template.id}.\`
        : \`Print file generation failed: \${failures.map(f => f.error).join('; ')}\`
    );
    console.log(\`[WORKFLOW LOG] STEP 9 - Print PDF Generated for Order \${order.id}: \${generated ? 'SUCCESS' : 'FAILED'}\`);

    res.json({
      success: true,
      confirmed: true,
      printFiles: printFiles.map(f => ({ url: f.url, dpi: f.dpi, effectiveDpi: f.effectiveDpi, widthMm: f.widthMm, heightMm: f.heightMm })),
      failures
    });
`;

content = content.replace(targetContent, newLogic);
fs.writeFileSync(path, content, 'utf8');
console.log('Done modifying publicUpload.routes.js');
