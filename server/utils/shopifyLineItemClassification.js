/**
 * Shared, pure classification helpers for a single Shopify order line item.
 *
 * Both Shopify ingestion paths - the pull-based sync (server/services/shopify.service.js)
 * and the webhook push (server/services/shopifyWebhookService.js) - map one Shopify
 * order line item onto one THE PRINK order document. This module is the one place
 * that decides product type and default photo count from a line item's title/SKU,
 * so the two paths can't drift apart on it again.
 */

/** Keyword -> internal product type. First match wins; order matters. */
const PRODUCT_TYPE_KEYWORDS = [
  ['mug', 'mug'],
  ['frame', 'frame'],
  ['calendar', 'calendar'],
  ['photobook', 'photobook'],
  ['book', 'photobook'],
  ['magazine', 'magazine'],
  ['butterfly', 'butterfly'],
  ['tshirt', 'tshirt'],
  ['t-shirt', 'tshirt'],
  ['shirt', 'tshirt'],
  ['pillow', 'pillow'],
  ['cushion', 'pillow'],
  ['keychain', 'keychain'],
  ['key chain', 'keychain'],
  ['mobilecase', 'mobilecase'],
  ['mobile case', 'mobilecase'],
  ['phone case', 'mobilecase'],
];

/** Default photo count per product type, used when no SKU mapping overrides it. */
const PHOTO_COUNT_BY_TYPE = {
  butterfly: 8, magazine: 4, photobook: 24,
  calendar: 12, frame: 4, mug: 1, tshirt: 1,
  mobilecase: 1, pillow: 1, keychain: 2, canvas: 1
};

/** Line items matching these need no customer photo upload at all. */
const NON_CUSTOMIZABLE_KEYWORDS = ['gift card', 'gift-card', 'voucher', 'shipping', 'donation'];

/** Detect the internal product type from a line item's title. Defaults to 'canvas'. */
function detectProductType(title) {
  const t = (title || '').toLowerCase();
  for (const [keyword, type] of PRODUCT_TYPE_KEYWORDS) {
    if (t.includes(keyword)) return type;
  }
  return 'canvas';
}

/** True if a line item (by title or SKU) needs no customer photo upload. */
function isNonCustomizable(title, sku) {
  const t = (title || '').toLowerCase();
  const s = (sku || '').toLowerCase();
  return NON_CUSTOMIZABLE_KEYWORDS.some(k => t.includes(k) || s.includes(k));
}

module.exports = {
  PRODUCT_TYPE_KEYWORDS,
  PHOTO_COUNT_BY_TYPE,
  NON_CUSTOMIZABLE_KEYWORDS,
  detectProductType,
  isNonCustomizable,
};
