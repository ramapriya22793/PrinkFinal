/**
 * One-off migration: realign stored `printStatus` with the actual workflow.
 *
 * `printStatus` defaulted to 'queued' for every new order until that default
 * was changed to 'pending'. The orders created before the change still carry
 * 'queued' even though they have no approval and no print file. The printer
 * dashboard's status is now *derived* (server/utils/orderStatus.js), so this
 * is data hygiene rather than a behaviour fix - but it stops the stored
 * `printStatus` from lying to any code that reads it directly (e.g. the
 * printer transition guard).
 *
 * Only touches orders whose derived stage is 'pending' but whose stored
 * `printStatus` claims otherwise. Never advances an order.
 *
 *   node server/scripts/migrate-legacy-print-status.js            # dry run
 *   node server/scripts/migrate-legacy-print-status.js --execute  # apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { deriveDashStatus } = require('../utils/orderStatus');

const EXECUTE = process.argv.includes('--execute');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/theprink';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[migrate] connected to ${MONGODB_URI}`);
  console.log(`[migrate] mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);

  const cursor = Order.find(
    { printStatus: { $nin: ['pending', null] } },
    { id: 1, orderNumber: 1, printStatus: 1, workflowStatus: 1, adminApprovalStatus: 1, printGenerationStatus: 1, printFiles: 1, deliveryStatus: 1 }
  ).lean().cursor();

  let scanned = 0;
  let toFix = 0;
  const sample = [];

  for (let o = await cursor.next(); o != null; o = await cursor.next()) {
    scanned++;
    if (deriveDashStatus(o) !== 'pending') continue;   // genuinely further along - leave it
    toFix++;
    if (sample.length < 10) sample.push({ id: o.id, orderNumber: o.orderNumber, printStatus: o.printStatus, workflowStatus: o.workflowStatus });
    if (EXECUTE) {
      await Order.updateOne({ id: o.id }, { $set: { printStatus: 'pending' } });
    }
  }

  console.log(`[migrate] scanned ${scanned} non-'pending' orders`);
  console.log(`[migrate] ${EXECUTE ? 'reset' : 'would reset'} ${toFix} to printStatus:'pending'`);
  console.log('[migrate] sample:', JSON.stringify(sample, null, 2));
  if (!EXECUTE && toFix > 0) console.log('[migrate] re-run with --execute to apply');

  await mongoose.disconnect();
}

main().catch(err => { console.error('[migrate] FAILED:', err); process.exit(1); });
