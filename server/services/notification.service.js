/**
 * THE PRINK - customer notification dispatch.
 *
 * Design rules this module enforces:
 *
 *  1. IDEMPOTENT. Every message carries a dedupe key derived from the order,
 *     the message kind and the delivery day. Re-clicking "send" or a retried
 *     job cannot deliver the same message twice.
 *  2. NON-CORRUPTING. A provider outage records a failed notification and
 *     returns normally. Notification state is never allowed to roll back or
 *     block the order workflow.
 *  3. PLUGGABLE. WhatsApp is behind a provider interface. With no credentials
 *     configured the transport is `recorded` - the message is persisted for
 *     the team to action, and nothing pretends it was delivered.
 */

const crypto = require('crypto');
const Notification = require('../models/Notification');

/** Message templates. `order` is the workflow document. */
const TEMPLATES = {
  upload_link: order => ({
    title: 'Upload your photos',
    message: `Hello ${order.customer?.name || 'there'}, thank you for ordering from THE PRINK. `
      + `Please upload your photos for ${order.product}: ${order.uploadLink || ''}`
  }),
  upload_reminder: order => ({
    title: 'Reminder: photos needed',
    message: `Hi ${order.customer?.name || 'there'}, we're still waiting on your photos for order `
      + `${order.orderNumber || order.id}. Upload here: ${order.uploadLink || ''}`
  }),
  upload_complete: order => ({
    title: 'Photos received',
    message: `Thanks ${order.customer?.name || ''}! We've received your photos for ${order.product}.`
  }),
  design_confirmed: order => ({
    title: 'Design confirmed',
    message: `Your design for ${order.product} is confirmed and has gone to our print team.`
  }),
  admin_approved: order => ({
    title: 'Design approved',
    message: `Good news - your design for ${order.product} has been approved for printing.`
  }),
  printing_started: order => ({
    title: 'Printing started',
    message: `We've started printing your ${order.product}.`
  }),
  shipped: order => ({
    title: 'On its way',
    message: `Your order ${order.orderNumber || order.id} has shipped.`
  }),
  delivered: order => ({
    title: 'Delivered',
    message: `Your order ${order.orderNumber || order.id} has been delivered. Thank you for choosing THE PRINK!`
  })
};

/**
 * Stable dedupe key. The date component lets a genuine reminder go out on a
 * later day while blocking same-day duplicates.
 */
function dedupeKey(orderId, kind, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${orderId}:${kind}:${day}`).digest('hex');
}

function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Deliver via WhatsApp Business API when configured.
 * Returns {delivered, channel, error}. Never throws - the caller must not have
 * its workflow broken by a messaging outage.
 */
async function deliver(order, payload) {
  if (!whatsappConfigured()) {
    return { delivered: false, channel: 'recorded', error: 'WhatsApp is not configured' };
  }
  const phone = order.customer?.phone;
  if (!phone) {
    return { delivered: false, channel: 'recorded', error: 'Customer has no phone number' };
  }

  try {
    const axios = require('axios');
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: String(phone).replace(/[^\d+]/g, ''),
        type: 'text',
        text: { body: payload.message }
      },
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        timeout: 10000
      }
    );
    return { delivered: true, channel: 'whatsapp' };
  } catch (err) {
    // Record and continue: a provider outage must not corrupt the order.
    console.error('[NOTIFY] WhatsApp delivery failed:', err.message);
    return { delivered: false, channel: 'whatsapp', error: err.message };
  }
}

/**
 * Send (or record) a customer notification exactly once per order/kind/day.
 * @returns {Promise<{queued:boolean, duplicate:boolean, delivered:boolean,
 *                    channel:string, message:string}>}
 */
async function sendCustomerNotification(order, kind = 'upload_link') {
  // Check customization eligibility for upload request notifications
  if ((kind === 'upload_link' || kind === 'upload_reminder') && order && (order.requiresCustomization === false || Number(order.requiredPhotoCount || 0) <= 0)) {
    console.log(`[NOTIFY] Skipping customization notification for non-customizable order ${order.orderNumber || order.id}`);
    return {
      queued: false,
      duplicate: false,
      delivered: false,
      channel: 'none',
      message: 'Order does not require customization.'
    };
  }

  const build = TEMPLATES[kind];
  if (!build) throw new Error(`Unknown notification type "${kind}"`);

  const payload = build(order);
  const key = dedupeKey(order.id, kind);

  // Claim the key first. The unique index makes this atomic, so two concurrent
  // requests cannot both proceed to delivery.
  try {
    await Notification.create({
      id: key,
      userId: order.customer?.email || order.id,
      orderId: order.id,
      type: kind,
      title: payload.title,
      message: payload.message,
      status: 'pending'
    });
  } catch (err) {
    if (err.code === 11000) {
      return {
        queued: false, duplicate: true, delivered: false,
        channel: 'none', message: 'This notification was already sent today.'
      };
    }
    throw err;
  }

  // 1. Deliver via WhatsApp if configured
  const result = await deliver(order, payload);

  // 2. Deliver via Email for upload link notifications
  if (kind === 'upload_link' || kind === 'upload_reminder') {
    try {
      const emailService = require('./email.service');
      await emailService.sendCustomizationEmail(order);
    } catch (emailErr) {
      console.error('[NOTIFY] Failed to trigger customization email:', emailErr.message);
    }
  }

  await Notification.updateOne(
    { id: key },
    {
      $set: {
        status: result.delivered ? 'sent' : 'recorded',
        channel: result.channel,
        error: result.error || null,
        sentAt: new Date()
      }
    }
  ).catch(() => { /* the message is already persisted; status is cosmetic */ });

  return {
    queued: true,
    duplicate: false,
    delivered: result.delivered,
    channel: result.channel,
    message: result.delivered
      ? 'Notification sent.'
      : 'WhatsApp is not configured, so the notification was recorded for the team to send manually.'
  };
}

module.exports = { sendCustomerNotification, dedupeKey, TEMPLATES, whatsappConfigured };
