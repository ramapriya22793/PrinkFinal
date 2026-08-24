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
  printStatus: { type: String, default: 'queued' }, // queued, printing, completed

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
  trackingCompany: { type: String }
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

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);

