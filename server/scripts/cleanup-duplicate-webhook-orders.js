/**
 * One-time cleanup for orders duplicated by the pre-fix webhook bug
 * (see fix/webhook-multi-line-item-orders): before that fix, the webhook
 * path created one order per Shopify order using a bare id (the Shopify
 * order name, e.g. "139278"), reading only the first line item - while the
 * pull-based sync always used one order per line item, id
 * "{orderName}-{lineItemId}" (e.g. "139278-12839504871653").
 *
 * A Shopify order touched by both paths ends up with two documents for the
 * same real product: the old bare-id one (missing every item after the
 * first) and the correct per-item one from pull-sync.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-webhook-orders.js            # dry run - reports only, writes nothing
 *   node scripts/cleanup-duplicate-webhook-orders.js --execute  # actually deletes/merges
 *
 * Requires MONGODB_URI (or server/.env) pointing at the target database.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const EXECUTE = process.argv.includes('--execute');

// Matches "...-<digits>" at the end of an id - the per-line-item suffix
// both the pull sync and the fixed webhook now use.
const NEW_SCHEME_RE = /-\d+$/;

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/theprink';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`Connected to ${uri.replace(/\/\/[^@/]+@/, '//***:***@')}`);
  console.log(EXECUTE ? '*** EXECUTE MODE - will delete/merge documents ***' : 'DRY RUN - no changes will be made (pass --execute to apply)');
  console.log('');

  const Order = mongoose.connection.collection('orders');

  const groups = await Order.aggregate([
    { $group: { _id: '$shopifyId', docs: { $push: '$$ROOT' }, count: { $sum: 1 } } },
    { $match: { count: { $gte: 2 }, _id: { $ne: null, $ne: '' } } }
  ]).toArray();

  console.log(`Found ${groups.length} Shopify order(s) with more than one order document.\n`);

  let confirmedDuplicates = 0;
  let needsManualReview = 0;
  let deleted = 0;
  let merged = 0;

  for (const group of groups) {
    const oldSchemeDocs = group.docs.filter(d => !NEW_SCHEME_RE.test(d.id));
    const newSchemeDocs = group.docs.filter(d => NEW_SCHEME_RE.test(d.id));

    if (oldSchemeDocs.length === 0) continue; // all new-scheme - legitimate multi-item order, not the bug

    for (const oldDoc of oldSchemeDocs) {
      const match = newSchemeDocs.find(d =>
        (d.sku || '') === (oldDoc.sku || '') && (d.product || '') === (oldDoc.product || '')
      );

      if (!match) {
        needsManualReview++;
        console.log(`[MANUAL REVIEW] shopifyId ${group._id}: old-scheme doc "${oldDoc.id}" (${oldDoc.product} / ${oldDoc.sku}) has no matching new-scheme sibling - product/SKU may have changed, or pull-sync hasn't run for this order yet. Not touching.`);
        continue;
      }

      confirmedDuplicates++;
      const oldHasCustomerWork = (oldDoc.images && oldDoc.images.length > 0) || !!oldDoc.designLockedAt;
      const matchHasCustomerWork = (match.images && match.images.length > 0) || !!match.designLockedAt;

      console.log(`[DUPLICATE] shopifyId ${group._id}: old-scheme "${oldDoc.id}" duplicates new-scheme "${match.id}" (${oldDoc.product} / ${oldDoc.sku})`);

      if (oldHasCustomerWork && !matchHasCustomerWork) {
        console.log(`  -> old doc has customer uploads/design lock the new doc doesn't - will merge into "${match.id}" before deleting "${oldDoc.id}"`);
        if (EXECUTE) {
          await Order.updateOne(
            { id: match.id },
            {
              $set: {
                images: oldDoc.images,
                designLockedAt: oldDoc.designLockedAt,
                customizationStatus: oldDoc.customizationStatus,
                uploadStatus: oldDoc.uploadStatus,
                workflowStatus: oldDoc.workflowStatus
              }
            }
          );
          merged++;
        }
      } else if (oldHasCustomerWork && matchHasCustomerWork) {
        needsManualReview++;
        console.log(`  -> BOTH docs have customer uploads/design lock - needs manual review, not auto-merging.`);
        continue;
      } else {
        console.log(`  -> old doc has no customer work - safe to delete outright.`);
      }

      if (EXECUTE) {
        await Order.deleteOne({ id: oldDoc.id });
        deleted++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Confirmed duplicates: ${confirmedDuplicates}`);
  console.log(`Needs manual review:  ${needsManualReview}`);
  if (EXECUTE) {
    console.log(`Deleted: ${deleted}`);
    console.log(`Merged into surviving doc: ${merged}`);
  } else {
    console.log('\nRe-run with --execute to apply these changes.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('FAILED:', err.message, err.stack);
  process.exit(1);
});
