// =========================================================================
// THE PRINK — Shared TypeScript Types (Expanded)
// =========================================================================

export type PortalType = 'customer' | 'admin' | 'printer';
export type CustomerSubView = 'dashboard' | 'editor' | 'tracking' | 'drafts' | 'upload' | 'preview' | 'profile' | 'support' | 'templates';
export type AdminSection = 'overview' | 'orders' | 'monitor' | 'templates' | 'queue' | 'reports' | 'settings' | 'workflow' | 'sku-mappings';
export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type CropMaskType = 'circle' | 'square' | 'rect';
export type ProductType = 'mug' | 'canvas' | 'frame' | 'calendar' | 'photobook' | 'tshirt' | 'mobilecase' | 'pillow' | 'keychain' | 'butterfly';
export type DpiStatus = 'ok' | 'low' | 'none';
export type UploadStatus = 'ready' | 'awaiting' | 'pending';
export type PrintStatus = 'pending' | 'processing' | 'printing' | 'queued' | 'hold' | 'print-ready' | 'completed';
export type Priority = 'high' | 'normal' | 'low';
export type UploadMethod = 'file' | 'camera' | 'cloud';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export interface UploadedImage {
  id: string;
  src?: string;
  url?: string;
  previewUrl?: string;
  name: string;
  serverFilename?: string;
}

export interface PrintTheme {
  id: string;
  name: string;
  bg: string;
  accent: string;
  preview: string[];
}

export type CustomizationStatus = 'pending' | 'in-progress' | 'completed';
export type DeliveryStatus = 'pending' | 'shipped' | 'delivered';

export interface CanvasElement {
  id: string;
  type: 'text' | 'image' | 'shape' | 'sticker';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  
  // Text specific
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  gradientColor?: string;
  textShadow?: string;
  isCurved?: boolean;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  
  // Image specific
  src?: string;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  flipX?: boolean;
  flipY?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  sepia?: number;
  grayscale?: boolean;
  
  // Shape specific
  shapeType?: 'rect' | 'circle' | 'triangle' | 'star';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface SkuMapping {
  id?: string;
  sku: string;
  name: string;
  category: string;
  productType: ProductType;
  description?: string;
  productImage?: string;
  mockupImage?: string;
  templateId: string;
  templateName: string;
  printAreaWidth: number;
  printAreaHeight: number;
  printPosition?: string;
  supportedImageCount: number;
  supportedFileTypes: string[];
  maximumFileSize: number;
  orientation: string;
  printingInstructions?: string;
  status: string;
  customizationRules?: Record<string, any>;
}

export interface Order {
  id: string;
  shopifyId?: string;
  orderNumber?: string;
  name?: string;
  createdAt?: string | Date;
  designLockedAt?: string | Date;
  requiresCustomization?: boolean;
  requiredPhotoCount?: number;
  skuDetails?: SkuMapping;
  customer: string;
  product: string;
  productType: ProductType;
  sku?: string;
  quantity?: number;
  dpi: string;
  dpiStatus: DpiStatus;
  uploadStatus: UploadStatus;
  customizationStatus?: CustomizationStatus;
  deliveryStatus?: DeliveryStatus;
  designData?: string;
  adminComments?: string;
  date: string;
  phone?: string;
  images?: UploadedImage[];
  adminApprovalStatus?: 'pending' | 'approved' | 'rejected' | 'reupload';
  workflowStatus?: 'order_received' | 'personalization_pending' | 'photo_uploaded' | 'approved' | 'rejected' | 'sent_to_printer' | 'printer_processing' | 'printing' | 'ready_for_dispatch' | 'in_transit' | 'delivered' | 'completed';
  printStatus?: 'pending' | 'printing' | 'completed';
  submissionTime?: string;
  activityLogs?: any[];
  pdfUrl?: string;
  productImage?: string;
  variant?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingCompany?: string;
}

export interface PrinterQueueItem {
  id: string;
  customer: string;
  product: string;
  trimSize: string;
  status: PrintStatus;
  priority: Priority;
  assignedAt: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  productType: ProductType;
  thumbnail: string;
  usageCount: number;
  lastModified: string;
  elements?: CanvasElement[];
  skuMapping?: string[];
  isDefault?: boolean;
  category?: string;
  seasonal?: string;
  isPremium?: boolean;
  tags: string[];
}

export interface TrackingEvent {
  label: string;
  description: string;
  active: boolean;
  timestamp: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  type: 'order' | 'upload' | 'print' | 'system';
}
