const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  shopifyId: { type: String, sparse: true },
  orderNumber: { type: String },
  customer: {
    id: { type: String },
    name: { type: String },
    email: { type: String },
    phone: { type: String }
  },
  product: { type: String },
  productType: { type: String },
  productImage: { type: String },
  // Line item's Shopify product_id, used to (re-)resolve productImage
  // against the synced ShopifyProduct catalog - kept even when productImage
  // itself couldn't be resolved yet (e.g. the product catalog sync hadn't
  // caught up), so a later backfill has an exact join key instead of
  // falling back to fuzzy SKU matching.
  shopifyProductId: { type: String },
  // ─── Customization Config ────────────────────────────────────────────────
  // Whether this product/line-item requires customer photo upload.
  requiresCustomization: { type: Boolean, default: true },
  // Exact number of photos the customer must upload for this product.
  // Sourced from SKU.supportedImageCount during Shopify sync.
  requiredPhotoCount: { type: Number, default: 1 },
  printTemplate: { type: String, default: 'Standard Print Template' },
  customizationRules: { type: String, default: 'Standard Image Upload' },
  sku: { type: String },
  skuDetails: { type: mongoose.Schema.Types.Mixed },
  quantity: { type: Number, default: 1 },
  totalPrice: { type: String },
  dpiInfo: { type: mongoose.Schema.Types.Mixed },
  uploadStatus: { type: String, default: 'pending' },
  uploadToken: { type: String, sparse: true },
  // SHA-256 of the upload token. New orders store only the hash; `uploadToken`
  // is retained for links already issued to customers before this change.
  uploadTokenHash: { type: String, index: true, sparse: true },
  uploadTokenExpiresAt: { type: Date },
  linkOpenedAt: { type: Date },
  uploadLink: { type: String },
  customerNotes: { type: String },
  // Set once the customer confirms; acts as the idempotency guard that stops
  // duplicate print jobs and blocks further edits.
  designLockedAt: { type: Date, default: null },
  templateId: { type: String },
  templateSide: { type: String, enum: ['BLUE', 'RED', null] },
  linkedOrderId: { type: String },
  printFiles: [{ type: mongoose.Schema.Types.Mixed }],
  printGenerationStatus: { type: String, default: 'pending' },
  printGenerationErrors: [{ type: mongoose.Schema.Types.Mixed }],
  customizationStatus: { type: String, default: 'pending' },
  orderStatus: { type: String, default: 'Pending' }, // Pending -> Approved -> Printing -> Shipped -> Delivered
  adminApprovalStatus: { type: String, default: 'pending' }, // pending, approved, rejected
  // Defaults to 'pending', not 'queued' - printer.routes.js's own state
  // machine (STAGE_ORDER/ALLOWED_TRANSITIONS/DASHBOARD_STATUS) treats
  // 'queued' as "Print Ready", a status only earned after the customer has
  // uploaded photos and an admin has approved the design (see
  // order.routes.js's approve/generate-print-file flows, which explicitly
  // set printStatus:'queued' at that point). Defaulting new orders straight
  // to 'queued' put every order in the printer dashboard's Print Ready tab
  // from the moment it was created - before any photo, design lock, or
  // approval existed - which both hid genuinely ready orders in the noise
  // and gave printers nothing to generate a file from.
  printStatus: { type: String, default: 'pending' }, // pending, queued, processing, completed


  // ─── Unified Workflow Status ─────────────────────────────────────────────
  // Single source of truth for the 6-stage tracking flow shown across all portals:
  // Order Received -> Personalization Pending -> Printing -> Ready for Dispatch -> In Transit -> Delivered
  workflowStatus: {
    type: String,
    enum: ['order_received', 'personalization_pending', 'photo_uploaded', 'approved', 'rejected', 'sent_to_printer', 'printer_processing', 'printing', 'ready_for_dispatch', 'in_transit', 'delivered', 'completed'],
    default: 'order_received'
  },

  deliveryStatus: { type: String, default: 'unfulfilled' }, // unfulfilled, shipped, delivered
  images: [{ type: mongoose.Schema.Types.Mixed }],
  // Snapshot of the composition the customer confirmed, captured the first
  // time an admin edits it so the approved artwork is always recoverable.
  customerApprovedImages: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  designData: { type: mongoose.Schema.Types.Mixed },
  designRevisions: [{ type: mongoose.Schema.Types.Mixed }],
  printerAssignedAt: { type: Date },
  priority: { type: String, default: 'normal' },
  activityLogs: [{
    type: { type: String },
    text: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  shippingAddress: { type: mongoose.Schema.Types.Mixed },
  pdfUrl: { type: String },
  trackingNumber: { type: String },
  trackingUrl: { type: String },
  trackingCompany: { type: String },
  // A Shopify fulfillment webhook detected a shipped/delivered signal that
  // hasn't been confirmed yet. Deliberately NOT applied to deliveryStatus /
  // workflowStatus automatically - an admin reviews and confirms it (or
  // dismisses it if Shopify's data was wrong) via
  // POST /:id/confirm-delivery-update. null once there's nothing pending.
  // Shape: { status: 'shipped'|'delivered', trackingNumber, trackingUrl,
  //          trackingCompany, shopifyFulfillmentStatus, detectedAt }
  pendingDeliveryUpdate: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

// Indexes for the queries this app actually runs.
orderSchema.index({ orderNumber: 1 });                         // order number lookup
orderSchema.index({ adminApprovalStatus: 1, printStatus: 1 }); // printer queue
orderSchema.index({ 'customer.email': 1 });                // customer order lookup
orderSchema.index({ 'customer.phone': 1 });                // WhatsApp/phone lookup
orderSchema.index({ createdAt: -1 });                      // admin list ordering
orderSchema.index({ updatedAt: -1 });                      // alternative ordering
orderSchema.index({ uploadStatus: 1 });
orderSchema.index({ customizationStatus: 1 });
orderSchema.index({ adminApprovalStatus: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ printStatus: 1 });
orderSchema.index({ workflowStatus: 1 });                  // unified workflow tracking
orderSchema.index({ designLockedAt: -1 });                  // recent customer-submitted designs (dashboard widget)

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);

