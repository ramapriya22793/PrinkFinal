const test = require('node:test');
const assert = require('node:assert/strict');
const { deduplicateOrders } = require('../utils/orderDeduplication');

test('deduplicateOrders filters out legacy bare parent orders when line-item orders exist', () => {
  const orders = [
    { id: '186225-17439512723685', orderNumber: '86225', shopifyId: '7348032372965', product: 'Gift Wrap', sku: 'PG-GI-WP-01' },
    { id: '186225-17439512690917', orderNumber: '86225', shopifyId: '7348032372965', product: 'Birthday Miniature Magnet', sku: 'PG-PM-BM-01' },
    { id: '186225', orderNumber: '86225', shopifyId: '7348032372965', product: 'Birthday Miniature Magnet', sku: 'PG-PM-BM-01' }
  ];

  const result = deduplicateOrders(orders);
  assert.equal(result.cleanOrders.length, 2);
  assert.deepEqual(result.cleanOrders.map(o => o.id), ['186225-17439512723685', '186225-17439512690917']);
  assert.deepEqual(result.duplicateIdsToDelete, ['186225']);
});

test('deduplicateOrders merges customer images from bare doc to line-item doc if line-item doc has none', () => {
  const orders = [
    { id: '186225-17439512690917', orderNumber: '86225', shopifyId: '7348032372965', product: 'Birthday Miniature Magnet', sku: 'PG-PM-BM-01', images: [] },
    { id: '186225', orderNumber: '86225', shopifyId: '7348032372965', product: 'Birthday Miniature Magnet', sku: 'PG-PM-BM-01', images: [{ url: 'https://example.com/photo.jpg' }], customizationStatus: 'completed' }
  ];

  const result = deduplicateOrders(orders);
  assert.equal(result.cleanOrders.length, 1);
  assert.equal(result.cleanOrders[0].id, '186225-17439512690917');
  assert.equal(result.cleanOrders[0].images.length, 1);
  assert.equal(result.cleanOrders[0].customizationStatus, 'completed');
  assert.equal(result.mergesToPerform.length, 1);
  assert.equal(result.mergesToPerform[0].targetId, '186225-17439512690917');
});

test('deduplicateOrders preserves non-duplicate stand-alone orders', () => {
  const orders = [
    { id: '1001', orderNumber: '1001', shopifyId: '9001', product: 'Photo Frame', sku: 'PRK-FRM' },
    { id: '1002-12345', orderNumber: '1002', shopifyId: '9002', product: 'Mug', sku: 'PRK-MUG' }
  ];

  const result = deduplicateOrders(orders);
  assert.equal(result.cleanOrders.length, 2);
  assert.equal(result.duplicateIdsToDelete.length, 0);
});
