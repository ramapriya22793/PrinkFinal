/**
 * server/utils/orderStatus.js
 *
 * One place that decides an order's production stage from its stored status
 * fields.
 *
 * Historically this logic lived only in printer.routes.js and keyed off
 * `printStatus` alone. `printStatus` used to default to 'queued' for every
 * new order (see server/models/Order.js), and although that default was
 * later changed to 'pending', the ~100k orders created before the change
 * still carry `printStatus: 'queued'`. The printer dashboard therefore
 * showed all of them as "Print Ready" - with no photos, no approval and no
 * print file - burying the handful of genuinely ready jobs.
 *
 * `deriveDashStatus` now requires a genuinely approved AND rendered job
 * before it will report 'print-ready', so the derivation is correct
 * regardless of a stale stored `printStatus`.
 */

// The 4 stages the printer dashboard groups jobs into.
const DASH_STAGES = ['pending', 'print-ready', 'processing', 'completed'];

// workflowStatus values that mean "an admin has approved the design and it
// has moved at or past the print queue".
const APPROVED_OR_LATER_WORKFLOW = [
  'approved', 'sent_to_printer', 'printer_processing', 'printing',
  'ready_for_dispatch', 'in_transit', 'delivered', 'completed',
];

/** True once an admin has approved this order's design for printing. */
function isApprovedForPrint(order = {}) {
  if (order.adminApprovalStatus === 'approved') return true;
  return APPROVED_OR_LATER_WORKFLOW.includes(order.workflowStatus);
}

/**
 * True once a genuine print-ready file exists for this order - one with no
 * missing/placeholder photo slots (see derivePrintGenerationStatus above).
 * `printGenerationStatus === 'completed'` is the authoritative signal;
 * printFiles.length alone is not, since a file can exist with blank slots.
 */
function hasPrintFile(order = {}) {
  if (order.printGenerationStatus === 'completed') return true;
  if (order.printGenerationStatus === 'partial' || order.printGenerationStatus === 'failed') return false;
  // No printGenerationStatus recorded (older data) - fall back to "a file
  // with no known missing images exists".
  return Array.isArray(order.printFiles)
    && order.printFiles.some(f => f && !f.missingImages);
}

/**
 * Map an order onto the printer dashboard's 4-stage vocabulary:
 *   pending -> print-ready -> processing -> completed
 */
function deriveDashStatus(order = {}) {
  const ws = order.workflowStatus;
  const ps = order.printStatus;

  // Terminal / in-flight states win outright.
  if (ws === 'completed' || ws === 'delivered' || ps === 'completed') return 'completed';
  if (ws === 'printer_processing' || ws === 'printing' || ps === 'processing') return 'processing';

  // "Print Ready" = the customer's part is done, an admin approved it, and a
  // print file exists. A bare printStatus:'queued' is NOT enough.
  if (isApprovedForPrint(order) && hasPrintFile(order)) return 'print-ready';

  return 'pending';
}

/**
 * Given an order (post-update), return the `workflowStatus` that is
 * consistent with its other status fields. Used to stop `workflowStatus`
 * drifting out of sync when a write path only touches printStatus /
 * adminApprovalStatus / deliveryStatus. Never moves an order backwards past
 * a stage it has already reached.
 */
const WORKFLOW_RANK = {
  order_received: 0, personalization_pending: 1, photo_uploaded: 2,
  approved: 3, sent_to_printer: 4, printer_processing: 5, printing: 5,
  ready_for_dispatch: 6, in_transit: 7, delivered: 8, completed: 8,
  rejected: 2, // sits alongside photo_uploaded - a rejected design is re-worked from there
};

function reconcileWorkflowStatus(order = {}) {
  const current = order.workflowStatus || 'order_received';

  // Rejection is a state the customer must act on - never auto-override it.
  if (current === 'rejected' || order.adminApprovalStatus === 'rejected') return current;

  let target = current;
  const ds = deriveDashStatus(order);

  if (order.deliveryStatus === 'delivered') target = 'delivered';
  else if (order.deliveryStatus === 'shipped') target = 'in_transit';
  else if (ds === 'completed') target = 'ready_for_dispatch';
  else if (ds === 'processing') target = 'printer_processing';
  else if (ds === 'print-ready') target = 'sent_to_printer';
  else if (order.customizationStatus === 'completed' || order.uploadStatus === 'ready') {
    target = current === 'order_received' || current === 'personalization_pending'
      ? 'photo_uploaded' : current;
  }

  // Only ever advance.
  return (WORKFLOW_RANK[target] ?? 0) > (WORKFLOW_RANK[current] ?? 0) ? target : current;
}

/**
 * Decide the print-generation outcome from the files a render pass produced
 * and any per-image failures it hit.
 *
 * The multi-image generators (butterflyGenerator, magazineGenerator) fall
 * back to a grey placeholder for any customer photo they can't resolve
 * (local disk / S3 / GridFS all missed) rather than throwing, so a "file"
 * can exist with some or all of its photo slots blank. Each such file
 * reports how many via `missingImages`. A file with missing images is not
 * a real print-ready file - reporting 'completed' for one would silently
 * ship an order with blank photos.
 */
function derivePrintGenerationStatus(printFiles = [], failures = []) {
  if (printFiles.length === 0) return 'failed';
  const totalMissing = printFiles.reduce((n, f) => n + (f?.missingImages || 0), 0);
  if (failures.length > 0 || totalMissing > 0) return 'partial';
  return 'completed';
}

module.exports = {
  DASH_STAGES,
  deriveDashStatus,
  isApprovedForPrint,
  hasPrintFile,
  reconcileWorkflowStatus,
  derivePrintGenerationStatus,
};
