const sendUploadLinkMessage = async (order) => {
  try {
    if (!order.customer || (!order.customer.phone && !order.shippingAddress?.phone)) {
      console.warn(`[WHATSAPP SERVICE] Cannot send message to ${order.orderNumber}, no phone number found.`);
      return false;
    }

    const phone = order.customer.phone || order.shippingAddress.phone;
    const customerName = order.customer.firstName || order.shippingAddress?.firstName || 'Customer';

    console.log(`[WHATSAPP SERVICE] Sending upload link to ${phone} for order ${order.orderNumber}`);
    
    // TODO: Initialize WhatsApp API Client (Meta / Twilio / Interakt)
    // TODO: Send template message with order.uploadLink
    
    // Simulate successful send
    return true;
  } catch (error) {
    console.error(`[WHATSAPP SERVICE ERROR] Failed to send to ${order.orderNumber}:`, error.message);
    return false;
  }
};

module.exports = {
  sendUploadLinkMessage
};
