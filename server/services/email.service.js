/**
 * THE PRINK — Email Notification Service
 * Sends customization requests and order emails to customers.
 */

const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

/**
 * Generates HTML email template for customization upload request.
 */
function buildCustomizationEmailHtml({ orderNumber, productName, requiredPhotoCount, uploadLink, customerName }) {
  const displayOrderNo = orderNumber ? (orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`) : 'Your Order';
  const name = customerName || 'Valued Customer';
  const photoText = requiredPhotoCount === 1 ? '1 Photo' : `${requiredPhotoCount} Photos`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upload Photos for Your Order ${displayOrderNo}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: #171C62; color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; tracking-letter: -0.5px; }
    .header p { margin: 6px 0 0 0; opacity: 0.85; font-size: 14px; }
    .content { padding: 32px 24px; }
    .order-card { background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center; }
    .order-no { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .product-name { font-size: 16px; color: #334155; font-weight: 600; }
    .photo-badge { display: inline-block; background: #e0e7ff; color: #3730a3; font-weight: 700; font-size: 13px; padding: 6px 14px; border-radius: 20px; margin-top: 10px; }
    .cta-button { display: block; width: 80%; margin: 28px auto 16px auto; background: #171C62; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 16px; padding: 16px 24px; border-radius: 12px; text-align: center; box-shadow: 0 4px 12px rgba(23,28,98,0.25); }
    .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>THE PRINK</h1>
      <p>Custom Photo Upload Request</p>
    </div>
    <div class="content">
      <p>Hi <strong>${name}</strong>,</p>
      <p>Thank you for choosing <strong>THE PRINK</strong>! Your order requires custom photos to begin printing.</p>
      
      <div class="order-card">
        <div class="order-no">Order Number: ${displayOrderNo}</div>
        <div class="product-name">Product: ${productName}</div>
        <div class="photo-badge">📸 ${photoText} Required</div>
      </div>

      <p>Please click the button below to upload your photos directly to our secure design lab:</p>
      
      <a href="${uploadLink}" class="cta-button" target="_blank">Upload Photos Now &rarr;</a>

      <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 16px;">
        Or copy and paste this link into your browser:<br>
        <a href="${uploadLink}" style="color: #2563eb; word-break: break-all;">${uploadLink}</a>
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} THE PRINK. All rights reserved.<br>
      Need help? Reply to this email or contact support.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Send Customization Email Notification for an order.
 */
async function sendCustomizationEmail(order) {
  // Check customization eligibility
  if (!order || order.requiresCustomization === false || Number(order.requiredPhotoCount || 0) <= 0) {
    console.log(`[EMAIL SERVICE] Skipping email for non-customizable order: ${order?.orderNumber || order?.id}`);
    return { sent: false, reason: 'Order does not require customization' };
  }

  const recipientEmail = order.customer?.email || order.email;
  if (!recipientEmail) {
    console.warn(`[EMAIL SERVICE] Cannot send email for order ${order.orderNumber || order.id}: Missing recipient email address`);
    return { sent: false, reason: 'Missing recipient email address' };
  }

  const orderNumber = order.orderNumber || order.name || order.id;
  const productName = order.product || order.productType || 'Custom Print Product';
  const requiredPhotoCount = Number(order.requiredPhotoCount || 1);
  const uploadLink = order.uploadLink || `${process.env.CUSTOMER_APP_URL || 'https://customer.theprink.in'}/upload/${order.uploadToken}`;
  const customerName = order.customer?.name;

  const html = buildCustomizationEmailHtml({
    orderNumber,
    productName,
    requiredPhotoCount,
    uploadLink,
    customerName
  });

  const subject = `Action Required: Upload Photos for Order ${orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`} - THE PRINK`;

  const transporter = getTransporter();

  if (transporter) {
    try {
      const from = process.env.FROM_EMAIL || '"THE PRINK Orders" <orders@theprink.in>';
      await transporter.sendMail({
        from,
        to: recipientEmail,
        subject,
        html
      });
      console.log(`[EMAIL SERVICE] Customization email successfully dispatched to ${recipientEmail} for order ${orderNumber}`);
      return { sent: true, channel: 'email', recipient: recipientEmail };
    } catch (err) {
      console.error(`[EMAIL SERVICE ERROR] Failed to send email to ${recipientEmail}:`, err.message);
      return { sent: false, error: err.message };
    }
  } else {
    console.log(`[EMAIL SERVICE] SMTP not configured. Logged customization email preview for ${recipientEmail}:`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`TO: ${recipientEmail}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(`ORDER NO: ${orderNumber} | PRODUCT: ${productName} | PHOTOS REQUIRED: ${requiredPhotoCount}`);
    console.log(`UPLOAD LINK: ${uploadLink}`);
    console.log(`--------------------------------------------------------------------------------`);
    return { sent: true, channel: 'logged', recipient: recipientEmail };
  }
}

module.exports = {
  sendCustomizationEmail,
  buildCustomizationEmailHtml
};
