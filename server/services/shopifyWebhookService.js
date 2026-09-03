const crypto = require('crypto');
const db = require('../db');
const ShopifyOrder = require('../models/ShopifyOrder');
const notificationService = require('./notification.service');

/**
 * Parses Shopify Order payload, checks for duplicates, saves to MongoDB,
 * and generates a unique customer upload link.
 */
async function processShopifyOrderWebhook(payload, topic = 'orders/create') {
  if (!payload || (!payload.id && !payload.order_number)) {
    throw new Error('Invalid Shopify order payload');
  }

  const shopifyId = String(payload.id || '');
  const orderId = payload.name || `ORD-${payload.order_number || payload.id}`;
  
  console.log(`\n======================================================`);
  console.log(`[WORKFLOW LOG] STEP 1 & 2 - Shopify Order Created & Webhook Received`);
  console.log(`[WORKFLOW LOG] Processing Shopify order ${orderId} (Shopify ID: ${shopifyId})`);
  console.log(`======================================================\n`);

  // 1. Prevent duplicate orders by checking existing MongoDB records
  const existingOrder = await db.getOrderByShopifyId(shopifyId) || await db.getOrderById(orderId);
  if (existingOrder) {
    console.log(`[SHOPIFY WEBHOOK SERVICE] Duplicate order detected for orderId: ${existingOrder.id}. Updating record.`);
  }

  // 2. Parse Customer Info
  const customer = {
    name: payload.customer 
      ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() 
      : (payload.shipping_address?.name || 'Valued Customer'),
    email: payload.email || payload.customer?.email || '',
    phone: payload.shipping_address?.phone || payload.customer?.phone || payload.phone || ''
  };

  // 3. Extract Line Items / Product Details
  const lineItems = payload.line_items || [];
  const firstItem = lineItems[0] || {};
  const productTitle = firstItem.title || 'Custom Photo Product';
  const sku = firstItem.sku || 'CUSTOM-SKU';
  const quantity = firstItem.quantity || 1;

  // Customization Eligibility & Photo Count
  const nonCustomizableKeywords = ['gift card', 'gift-card', 'voucher', 'shipping', 'donation'];
  const pTitle = (productTitle || '').toLowerCase();
  const pSku = (sku || '').toLowerCase();
  const isNonCustomizable = nonCustomizableKeywords.some(k => pTitle.includes(k) || pSku.includes(k));

  let requiresCustomization = !isNonCustomizable;
  let requiredPhotoCount = isNonCustomizable ? 0 : 1;
  let printTemplate = 'Standard Print Template';
  let customizationRules = 'Standard Image Upload';
  let matchedProductType = firstItem.name || productTitle;

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

  // 4. Generate Unique Customer Upload Link & Token.
  // Reuse the existing token on a repeat webhook so a previously shared
  // WhatsApp link never stops working.
  const isNewToken = !existingOrder?.uploadToken;
  const uploadToken = existingOrder?.uploadToken || crypto.randomBytes(32).toString('hex');
  const uploadTokenHash = crypto.createHash('sha256').update(uploadToken).digest('hex');
  const expiryDays = Number(process.env.UPLOAD_LINK_EXPIRY_DAYS || 30);
  const uploadTokenExpiresAt = existingOrder?.uploadTokenExpiresAt
    || new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const baseUrl = process.env.CUSTOMER_APP_URL || 'https://customer.theprink.in';
  const uploadLink = `${baseUrl}/upload/${uploadToken}`;

  const fulfillment = (payload.fulfillments || [])[0] || {};
  const trackingNumber = fulfillment.tracking_number || payload.tracking_number || existingOrder?.trackingNumber || null;
  const trackingUrl = fulfillment.tracking_url || payload.tracking_url || existingOrder?.trackingUrl || null;
  const trackingCompany = fulfillment.tracking_company || payload.tracking_company || existingOrder?.trackingCompany || null;

  // 5. Build Parsed Order Payload
  const orderData = {
    id: orderId,
    shopifyId,
    orderNumber: String(payload.order_number || payload.id),
    email: customer.email || payload.email,
    phone: customer.phone || payload.phone,
    customer,
    product: productTitle,
    productType: matchedProductType,
    printTemplate,
    customizationRules,
    sku,
    quantity,
    requiresCustomization,
    requiredPhotoCount,
    totalPrice: payload.total_price || '0.00',
    uploadToken,
    uploadTokenHash,
    uploadTokenExpiresAt,
    uploadLink,
    uploadStatus: existingOrder?.uploadStatus || 'pending',
    customizationStatus: existingOrder?.customizationStatus || 'pending',
    orderStatus: existingOrder?.orderStatus || 'Pending',
    adminApprovalStatus: existingOrder?.adminApprovalStatus || 'pending',
    printStatus: existingOrder?.printStatus || 'queued',
    deliveryStatus: existingOrder?.deliveryStatus || 'unfulfilled',
    shippingAddress: payload.shipping_address || {},
    trackingNumber,
    trackingUrl,
    trackingCompany,
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

  // 6. Save or Update Order in MongoDB
  const savedOrder = await db.upsertOrder({ id: orderId }, orderData);
  console.log(`[WORKFLOW LOG] STEP 3 - Created/Updated Workflow in MongoDB for Order ${orderId}`);

  // 7. Store Raw & Structured Shopify Order Log (including uploadLink for Google Sheets sync)
  try {
    await ShopifyOrder.findOneAndUpdate(
      { shopifyOrderId: shopifyId },
      {
        shopifyOrderId: shopifyId,
        orderNumber: payload.order_number,
        name: payload.name || orderId,
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
        // Store uploadLink & uploadStatus so Google Sheets cron syncs can access them
        uploadLink,
        uploadStatus: orderData.uploadStatus || 'pending',
        rawJson: payload
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[SHOPIFY WEBHOOK SERVICE] Error saving ShopifyOrder log:', err.message);
  }

  // 8. Automatically dispatch Customization (Email & WhatsApp) Upload Link notification
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

  // 9. Automatically sync order to Google Sheets (real-time, on every new/updated order webhook)
  try {
    const { updateSpreadsheet } = require('./googleSheetService');
    // Use savedOrder which contains the full data including uploadLink
    const sheetOrder = {
      orderNumber: savedOrder.orderNumber || savedOrder.id,
      createdAt: savedOrder.createdAt || payload.created_at || new Date(),
      customer: {
        firstName: savedOrder.customer?.name?.split(' ')[0] || customer.name.split(' ')[0] || '',
        lastName: savedOrder.customer?.name?.split(' ').slice(1).join(' ') || customer.name.split(' ').slice(1).join(' ') || '',
        email: savedOrder.customer?.email || customer.email,
        phone: savedOrder.customer?.phone || customer.phone
      },
      lineItems: lineItems.map(item => ({ title: item.title, quantity: item.quantity })),
      totalPrice: savedOrder.totalPrice || payload.total_price || '',
      uploadLink: savedOrder.uploadLink || uploadLink,
      uploadStatus: savedOrder.uploadStatus || 'pending'
    };
    await updateSpreadsheet(sheetOrder);
    // Mark ShopifyOrder record as synced
    await ShopifyOrder.updateOne(
      { shopifyOrderId: shopifyId },
      { $set: { spreadsheetStatus: 'synced' } }
    ).catch(() => {});
    console.log(`[WORKFLOW LOG] Google Sheets updated successfully for Order ${orderId}`);
  } catch (sheetErr) {
    console.error('[SHOPIFY WEBHOOK SERVICE] Failed to sync order to Google Sheets:', sheetErr.message);
  }

  console.log(`[SHOPIFY WEBHOOK SERVICE] Successfully processed order ${orderId}. Upload Link: ${uploadLink}`);
  return { order: savedOrder, uploadLink, uploadToken };
}

module.exports = {
  processShopifyOrderWebhook
};
