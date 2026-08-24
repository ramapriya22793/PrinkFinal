const mongoose = require('mongoose');
const crypto = require('crypto');
const ButterflyTemplate = require('../models/ButterflyTemplate');
const ButterflyTemplateSlot = require('../models/ButterflyTemplateSlot');
const Order = require('../models/Order');
const { generateButterflyBoxPdf } = require('../utils/butterflyGenerator');
const db = require('../db');

/**
 * Runs the Butterfly Template Allocation Engine.
 * Must be called when a Butterfly Box order is confirmed (either by customer or force-approved).
 * @param {Object} claim - The Order object being confirmed
 * @param {Array} images - The 8 images uploaded
 * @returns {Object} { templateId, templateSide, linkedOrderId, printFiles, generated }
 */
async function allocateButterflyTemplate(claim, images) {
  let printFiles = [];
  let generated = false;
  let templateSide = 'BLUE';
  let butterflyTemplateId = null;
  let linkedOrderId = null;

  try {
    let template = await ButterflyTemplate.findOneAndUpdate(
      { status: 'WAITING_FOR_SECOND_CUSTOMER' },
      { $set: { status: 'READY_FOR_PRINT' } },
      { sort: { createdAt: 1 }, new: true }
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
      await slot.save();

      // Find the BLUE order to link and render
      const blueSlot = await ButterflyTemplateSlot.findOne({ templateId: template.id, side: 'BLUE' });
      if (blueSlot) {
        linkedOrderId = blueSlot.orderId;
        
        // Link the old order to this new one
        await Order.updateOne({ id: linkedOrderId }, { $set: { linkedOrderId: claim.id } });
        
        // Generate the shared PDF
        const blueOrder = await Order.findOne({ id: linkedOrderId });
        
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
          });
          
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
      await template.save();
      
      butterflyTemplateId = template.id;
      templateSide = 'BLUE';
      
      const slot = new ButterflyTemplateSlot({
        id: crypto.randomUUID(),
        templateId: template.id,
        side: 'BLUE',
        orderId: claim.id,
        customerId: claim.customer?.id || 'unknown'
      });
      await slot.save();
    }
  } catch (err) {
    console.error('[BUTTERFLY ALLOCATION ERROR]', err);
    throw err;
  }

  await db.addActivityLog(
    claim.id,
    'BUTTERFLY_ALLOCATED',
    `Assigned to Butterfly Template ${butterflyTemplateId} on the ${templateSide} side.`
  );
  
  if (generated) {
    await db.addActivityLog(
      claim.id,
      'PDF_GENERATED',
      `Shared Butterfly Print generated using template ${butterflyTemplateId}.`
    );
    if (linkedOrderId) {
       await db.addActivityLog(
        linkedOrderId,
        'PDF_GENERATED',
        `Shared Butterfly Print generated using template ${butterflyTemplateId}.`
      );
    }
  }

  return {
    templateId: butterflyTemplateId,
    templateSide,
    linkedOrderId,
    printFiles,
    generated
  };
}

module.exports = { allocateButterflyTemplate };
