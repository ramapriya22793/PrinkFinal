/**
 * One-off backfill: resolve productImage/shopifyProductId for orders that
 * predate the fix in shopifyWebhookService.js / shopify.service.js
 * (see PR "customer Orders list shows generic stock photos instead of real
 * Shopify product images").
 *
 * The Order schema never stored the Shopify product_id needed for an exact
 * re-resolution, so this matches by SKU against the synced ShopifyProduct
 * catalog's variants instead - a real but bounded recovery. Investigation
 * before writing this found (on a 5,000-order sample of image-less orders):
 *   - ~42% have no `sku` recorded on the order at all - nothing to match.
 *   - a further chunk reference SKUs no longer present in Shopify's current
 *     catalog (discontinued/seasonal products) - the image is genuinely
 *     gone from Shopify's side, not just unsynced.
 *   - only ~36% were recoverable via SKU matching in that sample.
 * Orders this can't resolve are left untouched; the customer portal's
 * existing stock-photo fallback (getProductImage()) remains the reasonable
 * degrade for them. Orders also self-heal over time via the existing
 * background live-Shopify sync in GET /api/orders/customer/orders, which
 * now benefits from the same underlying fix.
 *
 * Never overwrites an order that already has a productImage.
 *
 *   node server/scripts/backfill-order-product-images.js            # dry run
 *   node server/scripts/backfill-order-product-images.js --execute  # apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const ShopifyProduct = require('../models/ShopifyProduct');

const EXECUTE = process.argv.includes('--execute');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/theprink';
const BATCH_SIZE = 500;

async function buildSkuMap() {
  const products = await ShopifyProduct.find({}, { title: 1, images: 1, variants: 1 }).lean();
  const skuMap = new Map(); // sku -> { productImage, shopifyProductId }
  for (const p of products) {
    const image = (p.images && p.images[0]) || '';
    if (!image) continue;
    for (const v of (p.variants || [])) {
      const sku = (v.sku || '').trim();
      if (sku && !skuMap.has(sku)) {
        skuMap.set(sku, { productImage: image, shopifyProductId: p.shopifyProductId });
      }
    }
  }
  return skuMap;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[backfill] connected to ${MONGODB_URI}`);
  console.log(`[backfill] mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);

  const skuMap = await buildSkuMap();
  console.log(`[backfill] built SKU->image map from synced catalog: ${skuMap.size} SKUs with an image`);

  const cursor = Order.find(
    { $or: [{ productImage: { $exists: false } }, { productImage: '' }] },
    { id: 1, sku: 1 }
  ).lean().cursor();

  let scanned = 0;
  let noSku = 0;
  let skuNotFound = 0;
  let matched = 0;
  let pendingOps = [];
  const sample = [];

  const flush = async () => {
    if (pendingOps.length === 0) return;
    if (EXECUTE) await Order.bulkWrite(pendingOps, { ordered: false });
    pendingOps = [];
  };

  for (let o = await cursor.next(); o != null; o = await cursor.next()) {
    scanned++;
    const sku = (o.sku || '').trim();
    if (!sku) { noSku++; continue; }

    const hit = skuMap.get(sku);
    if (!hit) { skuNotFound++; continue; }

    matched++;
    if (sample.length < 15) sample.push({ id: o.id, sku, productImage: hit.productImage });
    pendingOps.push({
      updateOne: {
        filter: { id: o.id, $or: [{ productImage: { $exists: false } }, { productImage: '' }] },
        update: { $set: { productImage: hit.productImage, shopifyProductId: hit.shopifyProductId } }
      }
    });
    if (pendingOps.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`[backfill] scanned ${scanned} orders with no productImage`);
  console.log(`[backfill]   no SKU recorded at all: ${noSku} (${Math.round(100 * noSku / scanned)}%)`);
  console.log(`[backfill]   SKU present but not in synced catalog (discontinued/unsynced): ${skuNotFound} (${Math.round(100 * skuNotFound / scanned)}%)`);
  console.log(`[backfill]   ${EXECUTE ? 'resolved' : 'would resolve'}: ${matched} (${Math.round(100 * matched / scanned)}%)`);
  console.log('[backfill] sample:', JSON.stringify(sample, null, 2));
  if (!EXECUTE && matched > 0) console.log('[backfill] re-run with --execute to apply');

  await mongoose.disconnect();
}

main().catch(err => { console.error('[backfill] FAILED:', err); process.exit(1); });
