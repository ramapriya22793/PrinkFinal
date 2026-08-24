/**
 * THE PRINK - Canonical print template definitions.
 *
 * This is the SINGLE source of truth for product geometry. The customer's live
 * browser preview, the admin preview and the server-side print renderer all
 * resolve their geometry from these definitions (served over
 * GET /api/templates/resolve), so the three can never drift apart.
 *
 * Coordinate system
 * -----------------
 * `printArea` is expressed in NORMALISED units (0..1) relative to the mockup
 * image. Normalised units are resolution independent: the browser multiplies
 * them by the on-screen mockup size, the renderer multiplies them by the full
 * 300-DPI pixel canvas. Neither side hardcodes pixel offsets.
 *
 * `physical` carries the real-world print geometry (millimetres) used to
 * compute the output raster size and to validate effective DPI.
 *
 * Adding a product does NOT require touching application code: an admin can
 * store an equivalent document in the Template collection and assign SKUs to
 * it. These entries are only the built-in defaults/fallbacks.
 */

const MM_PER_INCH = 25.4;

/**
 * @typedef {Object} PrintTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} productType      Matched against SKU/product metadata
 * @property {string} mockupUrl        Preview-only backdrop (never printed)
 * @property {{x:number,y:number,w:number,h:number}} printArea  Normalised 0..1
 * @property {{widthMm:number,heightMm:number,bleedMm:number,safeMm:number}} physical
 * @property {number} dpi
 * @property {number} minSourcePx      Reject images below this on the long edge
 * @property {number} maxImages
 * @property {string[]} allowedTypes
 * @property {boolean} previewEnabled
 */

/**
 * `match` keywords are tested against the SKU, product type and product title.
 * Real SKU codes use abbreviations (PRK-FRM-810, TSH-WHT-L), so the abbreviated
 * forms are listed alongside the full words - otherwise those SKUs silently
 * fall through to the fallback template and print at the wrong physical size.
 *
 * @type {PrintTemplate[]}
 */
const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-mug-11oz',
    name: 'Classic Mug 11oz',
    productType: 'mug',
    match: ['mug'],
    mockupUrl: '/uploads/mug_mockup.png',
    printArea: { x: 0.07, y: 0.195, w: 0.66, h: 0.79 },
    physical: { widthMm: 200, heightMm: 85, bleedMm: 3, safeMm: 5 },
    dpi: 300,
    minSourcePx: 1200,
    maxImages: 2,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-case-generic',
    name: 'Phone Case',
    productType: 'mobilecase',
    match: ['case', 'cover', 'accessories', 'cas-', '-cas'],
    mockupUrl: '/uploads/case_mockup.png',
    printArea: { x: 0.28, y: 0.08, w: 0.44, h: 0.84 },
    physical: { widthMm: 75, heightMm: 150, bleedMm: 2, safeMm: 4 },
    dpi: 300,
    minSourcePx: 1000,
    maxImages: 1,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-frame-8x10',
    name: 'Photo Frame 8x10',
    productType: 'frame',
    match: ['frame', 'decor', 'frm'],
    mockupUrl: '/uploads/frame_mockup.png',
    printArea: { x: 0.215, y: 0.165, w: 0.57, h: 0.655 },
    physical: { widthMm: 203.2, heightMm: 254, bleedMm: 3, safeMm: 6 },
    dpi: 300,
    minSourcePx: 1800,
    maxImages: 1,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-apparel-tshirt',
    name: 'T-Shirt Front Print',
    productType: 'apparel',
    match: ['tshirt', 't-shirt', 'apparel', 'hoodie', 'tsh'],
    mockupUrl: '/uploads/tshirt_mockup.png',
    printArea: { x: 0.33, y: 0.24, w: 0.34, h: 0.44 },
    physical: { widthMm: 280, heightMm: 360, bleedMm: 0, safeMm: 8 },
    dpi: 300,
    minSourcePx: 1500,
    maxImages: 1,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-canvas-12x16',
    name: 'Canvas Print 12x16',
    productType: 'canvas',
    match: ['canvas', 'cnv'],
    mockupUrl: '/uploads/canvas_mockup.png',
    printArea: { x: 0.22, y: 0.22, w: 0.56, h: 0.56 },
    physical: { widthMm: 304.8, heightMm: 406.4, bleedMm: 12, safeMm: 15 },
    dpi: 300,
    minSourcePx: 2400,
    maxImages: 1,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-calendar-desk',
    name: 'Desk Calendar',
    productType: 'calendar',
    match: ['calendar', 'stationery', 'cal-', '-cal'],
    mockupUrl: '/uploads/calendar_mockup.png',
    printArea: { x: 0.04, y: 0.02, w: 0.92, h: 0.432 },
    physical: { widthMm: 210, heightMm: 148, bleedMm: 3, safeMm: 5 },
    dpi: 300,
    minSourcePx: 1400,
    maxImages: 12,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  },
  {
    id: 'tpl-butterfly-box',
    name: 'Butterfly Box',
    productType: 'butterfly',
    match: ['butterfly', 'box'],
    mockupUrl: '',
    printArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    physical: { widthMm: 81, heightMm: 81, bleedMm: 3, safeMm: 5 },
    dpi: 300,
    minSourcePx: 800,
    maxImages: 2,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    previewEnabled: true
  }
];

/** Last-resort template so an unmapped SKU still renders rather than crashing. */
const FALLBACK_TEMPLATE = DEFAULT_TEMPLATES.find(t => t.id === 'tpl-canvas-12x16');

/**
 * Resolve a template for a SKU using, in order of precedence:
 *   1. an explicit admin SKU->template assignment (passed in as `assignment`)
 *   2. keyword match against SKU / product type / product title
 *   3. the fallback template
 */
function resolveTemplate({ sku, productType, productTitle } = {}, assignment = null) {
  if (assignment) return assignment;

  const haystack = [sku, productType, productTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack) {
    for (const tpl of DEFAULT_TEMPLATES) {
      if (tpl.match.some(keyword => haystack.includes(keyword))) return tpl;
    }
  }
  return FALLBACK_TEMPLATE;
}

/** Full-bleed pixel size of the print canvas at the template's DPI. */
function printPixelSize(template) {
  const physical = template.physical || {
    widthMm: template.printArea?.widthMm || 200,
    heightMm: template.printArea?.heightMm || 200,
    bleedMm: template.printArea?.bleedMm || 3,
    safeMm: template.printArea?.safeMarginMm || 5
  };
  const { widthMm, heightMm, bleedMm } = physical;
  const dpi = template.dpi || template.printArea?.dpi || 300;
  const toPx = mm => Math.round((mm / MM_PER_INCH) * dpi);
  return {
    width: toPx(widthMm + (bleedMm || 0) * 2),
    height: toPx(heightMm + (bleedMm || 0) * 2),
    bleedPx: toPx(bleedMm || 0),
    safePx: toPx(physical.safeMm || 5),
    trimWidth: toPx(widthMm),
    trimHeight: toPx(heightMm)
  };
}

/**
 * Effective DPI a source image achieves once placed and scaled into the print
 * area. Used to warn/reject before the customer confirms a design that would
 * print soft.
 */
function effectiveDpi(sourceWidthPx, sourceHeightPx, template, scale = 1) {
  const { widthMm, heightMm } = template.physical;
  const wIn = widthMm / MM_PER_INCH;
  const hIn = heightMm / MM_PER_INCH;
  const safeScale = scale > 0 ? scale : 1;
  return Math.floor(Math.min(
    (sourceWidthPx * safeScale) / wIn,
    (sourceHeightPx * safeScale) / hIn
  ));
}

module.exports = {
  MM_PER_INCH,
  DEFAULT_TEMPLATES,
  FALLBACK_TEMPLATE,
  resolveTemplate,
  printPixelSize,
  effectiveDpi
};
