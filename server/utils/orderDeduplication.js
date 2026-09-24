/**
 * Shared order deduplication logic.
 *
 * Background:
 * In previous versions of the webhook and sync logic, an entire Shopify order
 * was saved as a single document with a bare id (e.g. "186225", "#186225", or "7348032372965").
 * Later, line-item splitting was added, creating documents with id:
 * "{orderName}-{lineItemId}" (e.g. "186225-17439512690917").
 *
 * When an order exists in both forms, queries matching by orderNumber, shopifyId,
 * or customer email return BOTH the bare parent document AND the line-item documents.
 * This caused the main product to be displayed twice in the Customer and Admin portals.
 *
 * This module detects legacy bare-id parent documents when line-item documents are present,
 * preserves any customer work (images, customization status), merges them into the corresponding
 * line-item document if needed, and removes/filters out the duplicate bare documents.
 */

function deduplicateOrders(ordersList) {
  if (!Array.isArray(ordersList) || ordersList.length <= 1) {
    return { cleanOrders: ordersList || [], duplicateIdsToDelete: [], mergesToPerform: [] };
  }

  // 1. Identify all orders that have line-item specific IDs (ending in -<digits>)
  const lineItemOrders = ordersList.filter(o => o && o.id && /-\d+$/.test(String(o.id)));
  const lineItemOrderKeys = new Set();
  
  for (const o of lineItemOrders) {
    const rawId = String(o.id);
    const baseId = rawId.replace(/-\d+$/, '').replace(/^#/, '').trim();
    if (baseId) {
      lineItemOrderKeys.add(baseId);
      lineItemOrderKeys.add(`#${baseId}`);
    }
    if (o.orderNumber) {
      const cleanNum = String(o.orderNumber).replace(/^#/, '').trim();
      lineItemOrderKeys.add(cleanNum);
      lineItemOrderKeys.add(`#${cleanNum}`);
    }
    if (o.shopifyId) {
      lineItemOrderKeys.add(String(o.shopifyId).trim());
    }
    if (o.name) {
      const cleanName = String(o.name).replace(/^#/, '').trim();
      lineItemOrderKeys.add(cleanName);
      lineItemOrderKeys.add(`#${cleanName}`);
    }
  }

  const cleanOrders = [];
  const duplicateIdsToDelete = [];
  const mergesToPerform = [];
  const seenIds = new Set();

  for (const o of ordersList) {
    if (!o || !o.id) continue;
    const rawId = String(o.id);
    const isLineItem = /-\d+$/.test(rawId);
    const cleanId = rawId.replace(/^#/, '').trim();
    const cleanNum = String(o.orderNumber || '').replace(/^#/, '').trim();
    const cleanShopifyId = String(o.shopifyId || '').trim();
    const cleanName = String(o.name || '').replace(/^#/, '').trim();

    // Check if this is a bare-id duplicate whose line-item siblings exist
    if (!isLineItem) {
      const isDuplicateParent = 
        lineItemOrderKeys.has(rawId) ||
        lineItemOrderKeys.has(cleanId) ||
        (cleanNum && lineItemOrderKeys.has(cleanNum)) ||
        (cleanShopifyId && lineItemOrderKeys.has(cleanShopifyId)) ||
        (cleanName && lineItemOrderKeys.has(cleanName));

      if (isDuplicateParent) {
        duplicateIdsToDelete.push(o.id);

        // Check if legacy bare doc has customer work that should be merged
        const hasCustomerWork = (o.images && o.images.length > 0) || !!o.designLockedAt;
        if (hasCustomerWork) {
          // Find the matching line-item order by SKU or product name
          const match = lineItemOrders.find(li => 
            (String(li.sku || '').toLowerCase() === String(o.sku || '').toLowerCase() && String(li.sku || '') !== '') ||
            (String(li.product || '').toLowerCase() === String(o.product || '').toLowerCase())
          ) || lineItemOrders[0];

          if (match && (!match.images || match.images.length === 0)) {
            mergesToPerform.push({
              targetId: match.id,
              data: {
                images: o.images,
                designLockedAt: o.designLockedAt,
                customizationStatus: o.customizationStatus,
                uploadStatus: o.uploadStatus,
                workflowStatus: o.workflowStatus,
                designData: o.designData
              }
            });
            // Update match in memory as well
            Object.assign(match, mergesToPerform[mergesToPerform.length - 1].data);
          }
        }
        continue; // Exclude legacy bare duplicate
      }
    }

    // Avoid exact duplicate IDs
    if (seenIds.has(rawId)) {
      duplicateIdsToDelete.push(o.id);
      continue;
    }
    seenIds.add(rawId);
    cleanOrders.push(o);
  }

  return { cleanOrders, duplicateIdsToDelete, mergesToPerform };
}

async function cleanupDuplicateOrdersInDb(OrderModel, duplicateIdsToDelete, mergesToPerform = []) {
  if (!OrderModel) return;
  try {
    if (mergesToPerform && mergesToPerform.length > 0) {
      for (const merge of mergesToPerform) {
        await OrderModel.updateOne({ id: merge.targetId }, { $set: merge.data });
        console.log(`[DEDUPLICATION] Merged customer work into line item: ${merge.targetId}`);
      }
    }
    if (duplicateIdsToDelete && duplicateIdsToDelete.length > 0) {
      await OrderModel.deleteMany({ id: { $in: duplicateIdsToDelete } });
      console.log(`[DEDUPLICATION] Deleted ${duplicateIdsToDelete.length} duplicate order documents from DB:`, duplicateIdsToDelete);
    }
  } catch (err) {
    console.warn('[DEDUPLICATION ERROR] Failed to clean up duplicate orders in DB:', err.message);
  }
}

function deduplicateOrderImages(images, requiredCount) {
  if (!Array.isArray(images) || images.length <= 1) return images || [];

  const result = [];
  const seenOriginalKeys = new Set();
  const seenUrls = new Set();
  const seenIds = new Set();

  const croppedMap = new Map();
  for (const img of images) {
    if (!img) continue;
    const name = String(img.name || '');
    if (name.startsWith('cropped_')) {
      const baseName = name.replace(/^cropped_/, '');
      croppedMap.set(baseName, img);
    }
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) continue;
    const id = String(img.id || img._id || '');
    const url = String(img.url || img.src || '');
    const originalKey = String(img.originalKey || '');
    const name = String(img.name || '');

    if (croppedMap.has(name)) {
      const croppedVersion = croppedMap.get(name);
      result.push({
        ...img,
        ...croppedVersion,
        id: img.id || croppedVersion.id,
        isCropped: true
      });
      croppedMap.delete(name);
      continue;
    }

    if (name.startsWith('cropped_')) {
      const baseName = name.replace(/^cropped_/, '');
      if (result.some(r => r.name === name || r.name === baseName || r.url === img.url)) {
        continue;
      }
    }

    if (url && seenUrls.has(url)) continue;
    if (originalKey && seenOriginalKeys.has(originalKey)) continue;
    if (id && seenIds.has(id)) continue;

    if (url) seenUrls.add(url);
    if (originalKey) seenOriginalKeys.add(originalKey);
    if (id) seenIds.add(id);

    result.push(img);
  }

  if (requiredCount && requiredCount > 0 && result.length > requiredCount) {
    return result.slice(0, requiredCount);
  }

  return result;
}

module.exports = {
  deduplicateOrders,
  cleanupDuplicateOrdersInDb,
  deduplicateOrderImages
};
