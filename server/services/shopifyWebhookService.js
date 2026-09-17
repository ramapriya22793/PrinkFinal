const crypto = require('crypto');
const db = require('../db');
const ShopifyOrder = require('../models/ShopifyOrder');
const ShopifyProduct = require('../models/ShopifyProduct');
const notificationService = require('./notification.service');
const { detectProductType, isNonCustomizable, PHOTO_COUNT_BY_TYPE } = require('../utils/shopifyLineItemClassification');

/**
 * Shopify tells us an order shipped/delivered via `fulfillment_status`
 * ('fulfilled'/'partial') and, when the shop uses Shopify's own tracking,
 * a per-fulfillment `shipment_status` ('delivered' is the only value that
 * unambiguously means "at the customer's door" - the in-transit ones vary
 * by carrier and aren't worth branching on individually).
 *
 * This is intentionally NOT written straight to deliveryStatus/workflowStatus:
 * Shopify data can be wrong or premature, so it's surfaced to an admin as a
 * `pendingDeliveryUpdate` for a one-click confirm (or dismiss) instead -
 * see POST /:id/confirm-delivery-update and /:id/dismiss-delivery-update.
 */
function detectPendingDeliveryUpdate(payload, fulfillment, existingOrder) {
  const shopifyFulfillmentStatus = payload.fulfillment_status || null; // null | 'partial' | 'fulfilled'
  const shipmentStatus = fulfillment.shipment_status || null;

  let targetStatus = null;
  if (shipmentStatus === 'delivered') {
    targetStatus = 'delivered';
  } else if (shopifyFulfillmentStatus === 'fulfilled' || shopifyFulfillmentStatus === 'partial') {
    targetStatus = 'shipped';
  }

  if (!targetStatus) {
    // No shipped/delivered signal in this payload - leave any existing
    // pending update alone rather than clearing it.
    return existingOrder?.pendingDeliveryUpdate || null;
  }
  // Already applied (an admin confirmed this, or it was set some other way) -
  // nothing to flag.
  if (existingOrder?.deliveryStatus === targetStatus) return null;
  // Already flagged for the same target - keep the original detectedAt
  // instead of bumping it on every repeat webhook for the same order.
  if (existingOrder?.pendingDeliveryUpdate?.status === targetStatus) {
    return existingOrder.pendingDeliveryUpdate;
  }

  return {
    status: targetStatus,
    trackingNumber: fulfillment.tracking_number || payload.tracking_number || null,
    trackingUrl: fulfillment.tracking_url || payload.tracking_url || null,
    trackingCompany: fulfillment.tracking_company || payload.tracking_company || null,
    shopifyFulfillmentStatus,
    detectedAt: new Date()
  };
}

/**
 * Parses Shopify Order payload, checks for duplicates, saves to MongoDB,
 * and generates a unique customer upload link.
 *
 * A Shopify order can contain multiple line items (multiple different
 * products in one checkout), each with its own customization requirements
 * (a frame needs 4 photos, a mug needs 1). One THE PRINK order is created
 * per line item - never just the first - using the same
 * `{shopifyOrderName}-{lineItemId}` id scheme as the pull-based sync
 * (server/services/shopify.service.js), so an order processed by either
 * path lands on the same record instead of creating duplicates.
 */
async function processShopifyOrderWebhook(payload, topic = 'orders/create') {
  if (!payload || (!payload.id && !payload.order_number)) {
    throw new Error('Invalid Shopify order payload');
  }

  const shopifyId = String(payload.id || '');
  const orderName = payload.name || `#${payload.order_number || payload.id}`;

  console.log(`\n======================================================`);
  console.log(`[WORKFLOW LOG] STEP 1 & 2 - Shopify Order Created & Webhook Received`);
  console.log(`[WORKFLOW LOG] Processing Shopify order ${orderName} (Shopify ID: ${shopifyId})`);
  console.log(`======================================================\n`);

  // Parse Customer Info - shared across every line item of this order.
  const customer = {
    name: payload.customer
      ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
      : (payload.shipping_address?.name || 'Valued Customer'),
    email: payload.email || payload.customer?.email || '',
    phone: payload.shipping_address?.phone || payload.customer?.phone || payload.phone || ''
  };

  const fulfillment = (payload.fulfillments || [])[0] || {};
  const trackingNumber = fulfillment.tracking_number || payload.tracking_number || null;
  const trackingUrl = fulfillment.tracking_url || payload.tracking_url || null;
  const trackingCompany = fulfillment.tracking_company || payload.tracking_company || null;

  // A line-item-less order shouldn't happen in practice, but previously this
  // function still created one order using placeholder product details in
  // that case - preserved here as a single synthetic item.
  const lineItems = payload.line_items && payload.line_items.length > 0
    ? payload.line_items
    : [{ id: 'noitem', title: 'Custom Photo Product', sku: 'CUSTOM-SKU', quantity: 1 }];

  const savedOrders = [];
  let firstResult = null;

  for (const item of lineItems) {
    const orderId = `${orderName}-${item.id}`;
    const productTitle = item.title || 'Custom Photo Product';
    const sku = item.sku || 'CUSTOM-SKU';
    const quantity = item.quantity || 1;

    // 1. Prevent duplicate orders by checking existing MongoDB records for
    // this specific line item (not the whole Shopify order - several sibling
    // orders now share the same shopifyId).
    const existingOrder = await db.getOrderById(orderId);
    if (existingOrder) {
      console.log(`[SHOPIFY WEBHOOK SERVICE] Duplicate order detected for orderId: ${existingOrder.id}. Updating record.`);
    }

    // Product image, for the customer portal's Orders list. Real-time
    // webhook payloads never carry a product image - only a product_id -
    // so this depends on the product already being synced locally via the
    // Shopify product catalog sync (see shopify.service.js's
    // runFullProductSync / the scheduled job in jobs/sync.js). Persisting
    // shopifyProductId (not just the resolved image) means a later backfill
    // can re-resolve this once the catalog sync has caught up, instead of
    // falling back to fuzzy SKU matching.
    let productImage = '';
    const shopifyProductId = item.product_id ? String(item.product_id) : '';
    try {
      if (shopifyProductId) {
        const dbProduct = await ShopifyProduct.findOne({ shopifyProductId }).lean();
        if (dbProduct && dbProduct.images && dbProduct.images.length > 0) {
          productImage = dbProduct.images[0];
        }
      }
    } catch (err) {
      console.warn('[SHOPIFY WEBHOOK SERVICE] Failed to resolve productImage from ShopifyProduct:', err.message);
    }

    // Customization Eligibility & Photo Count
    const nonCustomizable = isNonCustomizable(productTitle, sku);
    const productType = detectProductType(productTitle);

    let requiresCustomization = !nonCustomizable;
    let requiredPhotoCount = nonCustomizable ? 0 : (PHOTO_COUNT_BY_TYPE[productType] || 1);
    let printTemplate = 'Standard Print Template';
    let customizationRules = 'Standard Image Upload';
    let matchedProductType = item.name || productTitle;

    try {
      const skuMapping = await db.getSkuMappingBySku(sku) || await db.getSkuByCode(sku);
      if (skuMapping) {
        if (typeof skuMapping.requiresCustomization === 'boolean') {
          requiresCustomization = skuMapping.requiresCustomization;
        }
        if (typeof skuMapping.requiredPhotoCount === 'number') {
          requiredPhotoCount = skuMapping.requiredPhotoCount;
        } else if (typeof skuMapping.supportedImageCount === 'number') {
          requiredPhotoCount = skuMapping.supportedImageCount;
        }
        if (skuMapping.productType) {
          matchedProductType = skuMapping.productType;
        }
        if (skuMapping.printTemplate) {
          printTemplate = skuMapping.printTemplate;
        }
        if (skuMapping.customizationRules) {
          customizationRules = skuMapping.customizationRules;
        }
      }
    } catch (e) {
      console.warn('[SHOPIFY WEBHOOK SERVICE] SKU lookup fallback:', e.message);
    }

    // Generate this line item's own upload link & token. Reuse the existing
    // token on a repeat webhook so a previously shared WhatsApp link never
    // stops working.
    const isNewToken = !existingOrder?.uploadToken;
    const uploadToken = existingOrder?.uploadToken || crypto.randomBytes(32).toString('hex');
    const uploadTokenHash = crypto.createHash('sha256').update(uploadToken).digest('hex');
    const expiryDays = Number(process.env.UPLOAD_LINK_EXPIRY_DAYS || 30);
    const uploadTokenExpiresAt = existingOrder?.uploadTokenExpiresAt
      || new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const baseUrl = process.env.CUSTOMER_APP_URL || 'https://customer.theprink.in';
    const uploadLink = `${baseUrl}/upload/${uploadToken}`;

    const orderData = {
      id: orderId,
      shopifyId,
      orderNumber: String(payload.order_number || payload.id),
      email: customer.email || payload.email,
      phone: customer.phone || payload.phone,
      customer,
      product: productTitle,
      productType: matchedProductType,
      productImage: productImage || existingOrder?.productImage || '',
      shopifyProductId: shopifyProductId || existingOrder?.shopifyProductId || '',
      printTemplate,
      customizationRules,
      sku,
      quantity,
      requiresCustomization,
      requiredPhotoCount,
      totalPrice: item.price || payload.total_price || '0.00',
      uploadToken,
      uploadTokenHash,
      uploadTokenExpiresAt,
      uploadLink,
      uploadStatus: existingOrder?.uploadStatus || 'pending',
      customizationStatus: existingOrder?.customizationStatus || 'pending',
      orderStatus: existingOrder?.orderStatus || 'Pending',
      adminApprovalStatus: existingOrder?.adminApprovalStatus || 'pending',
      // 'pending', not 'queued' - see server/models/Order.js's printStatus
      // comment. A brand-new order has no photos, no approval, and no print
      // file yet, so it shouldn't already show as "Print Ready".
      printStatus: existingOrder?.printStatus || 'pending',
      deliveryStatus: existingOrder?.deliveryStatus || 'unfulfilled',
      shippingAddress: payload.shipping_address || {},
      trackingNumber,
      trackingUrl,
      trackingCompany,
      pendingDeliveryUpdate: detectPendingDeliveryUpdate(payload, fulfillment, existingOrder),
      activityLogs: existingOrder?.activityLogs || [
        {
          type: 'WEBHOOK_RECEIVED',
          text: `Order ${orderId} received from Shopify via webhook (${topic}).`,
          timestamp: new Date()
        },
        {
          type: 'UPLOAD_LINK_GENERATED',
          text: `Customer upload link generated: ${uploadLink}`,
          timestamp: new Date()
        }
      ]
    };

    const savedOrder = await db.upsertOrder({ id: orderId }, orderData);
    console.log(`[WORKFLOW LOG] STEP 3 - Created/Updated Workflow in MongoDB for Order ${orderId}`);
    savedOrders.push(savedOrder);

    // Log only when this webhook is the one that newly surfaced the pending
    // update (not on every repeat webhook that still carries the same one).
    const newlyPending = orderData.pendingDeliveryUpdate
      && existingOrder?.pendingDeliveryUpdate?.status !== orderData.pendingDeliveryUpdate.status;
    if (newlyPending) {
      await db.addActivityLog(
        orderId,
        'SHOPIFY_DELIVERY_UPDATE_PENDING',
        `Shopify reports this order as ${orderData.pendingDeliveryUpdate.status}. Awaiting admin confirmation before updating the customer's tracking view.`
      );
    }

    // Automatically dispatch Customization (Email & WhatsApp) Upload Link
    // notification for this line item's order.
    try {
      if (savedOrder && savedOrder.requiresCustomization !== false && Number(savedOrder.requiredPhotoCount || 1) > 0) {
        if (isNewToken || existingOrder?.uploadStatus === 'pending') {
          await notificationService.sendCustomerNotification(savedOrder, 'upload_link');
          console.log(`[WORKFLOW LOG] STEP 4 - Customization Trigger Sent for Order ${orderId} with Upload Link: ${uploadLink}`);
        }
      } else {
        console.log(`[WORKFLOW LOG] STEP 4 - Skipping customization notification for non-customizable Order ${orderId}`);
      }
    } catch (err) {
      console.error('[SHOPIFY WEBHOOK SERVICE] Failed to trigger customization notification:', err.message);
    }

    if (!firstResult) {
      firstResult = { order: savedOrder, uploadLink, uploadToken };
    }
  }

  // Clean up any legacy bare-id order document (from pre-line-item split era)
  try {
    const OrderModel = require('../models/Order');
    const bareIds = [orderName, payload.name, `#${payload.order_number}`, String(payload.order_number), shopifyId].filter(Boolean);
    const legacyBareOrders = await OrderModel.find({
      id: { $in: bareIds },
      $or: [
        { shopifyId: shopifyId },
        { orderNumber: String(payload.order_number) },
        { orderNumber: payload.order_number }
      ]
    }).lean();

    for (const legacy of legacyBareOrders) {
      if (legacy.images && legacy.images.length > 0 && savedOrders.length > 0) {
        await OrderModel.updateOne(
          { id: savedOrders[0].id },
          {
            $set: {
              images: legacy.images,
              designLockedAt: legacy.designLockedAt,
              customizationStatus: legacy.customizationStatus,
              uploadStatus: legacy.uploadStatus,
              workflowStatus: legacy.workflowStatus
            }
          }
        );
      }
      await OrderModel.deleteOne({ id: legacy.id });
      console.log(`[SHOPIFY WEBHOOK SERVICE] Deleted legacy bare-id duplicate order document: ${legacy.id}`);
    }
  } catch (cleanErr) {
    console.warn('[SHOPIFY WEBHOOK SERVICE] Cleanup legacy bare order error:', cleanErr.message);
  }

  // Store Raw & Structured Shopify Order Log once per Shopify order (not per
  // line item) - this is an order-level summary, and already lists every
  // line item in its own lineItems array.
  try {
    await ShopifyOrder.findOneAndUpdate(
      { shopifyOrderId: shopifyId },
      {
        shopifyOrderId: shopifyId,
        orderNumber: payload.order_number,
        name: payload.name || orderName,
        email: customer.email,
        financialStatus: payload.financial_status,
        fulfillmentStatus: payload.fulfillment_status || 'unfulfilled',
        totalPrice: payload.total_price,
        currency: payload.currency,
        createdAtShopify: payload.created_at ? new Date(payload.created_at) : new Date(),
        lineItems: lineItems.map(item => ({
          lineItemId: String(item.id),
          title: item.title,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku,
          productId: String(item.product_id),
          variantId: String(item.variant_id)
        })),
        customer: {
          shopifyCustomerId: String(payload.customer?.id || ''),
          firstName: payload.customer?.first_name,
          lastName: payload.customer?.last_name,
          email: payload.customer?.email,
          phone: customer.phone
        },
        shippingAddress: payload.shipping_address,
        // First line item's link, kept for backward compatibility with the
        // Google Sheets cron sync below, which expects a single link.
        uploadLink: firstResult?.uploadLink,
        uploadStatus: savedOrders[0]?.uploadStatus || 'pending',
        rawJson: payload
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[SHOPIFY WEBHOOK SERVICE] Error saving ShopifyOrder log:', err.message);
  }

  // Automatically sync order to Google Sheets (real-time, on every new/updated order webhook)
  try {
    const { updateSpreadsheet } = require('./googleSheetService');
    const sheetOrder = {
      orderNumber: payload.order_number || orderName,
      createdAt: savedOrders[0]?.createdAt || payload.created_at || new Date(),
      customer: {
        firstName: customer.name.split(' ')[0] || '',
        lastName: customer.name.split(' ').slice(1).join(' ') || '',
        email: customer.email,
        phone: customer.phone
      },
      lineItems: lineItems.map(item => ({ title: item.title, quantity: item.quantity })),
      totalPrice: payload.total_price || '',
      uploadLink: firstResult?.uploadLink,
      uploadStatus: savedOrders[0]?.uploadStatus || 'pending'
    };
    await updateSpreadsheet(sheetOrder);
    await ShopifyOrder.updateOne(
      { shopifyOrderId: shopifyId },
      { $set: { spreadsheetStatus: 'synced' } }
    ).catch(() => {});
    console.log(`[WORKFLOW LOG] Google Sheets updated successfully for Order ${orderName}`);
  } catch (sheetErr) {
    console.error('[SHOPIFY WEBHOOK SERVICE] Failed to sync order to Google Sheets:', sheetErr.message);
  }

  console.log(`[SHOPIFY WEBHOOK SERVICE] Successfully processed ${savedOrders.length} line item order(s) for Shopify order ${orderName}.`);
  return firstResult
    ? { order: firstResult.order, uploadLink: firstResult.uploadLink, uploadToken: firstResult.uploadToken, orders: savedOrders }
    : { order: null, orders: [] };
}

module.exports = {
  processShopifyOrderWebhook
};
