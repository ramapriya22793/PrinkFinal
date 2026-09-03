/**
 * Tests for the canonical transform model.
 *
 * The headline requirement is "customer preview == admin preview == print
 * output". That reduces to one testable property: the SAME transform applied
 * to canvases of different sizes must produce geometrically similar results.
 * These tests pin that property down.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTransform,
  fromLegacyImage,
  computePlacement,
  toCssTransform,
  DEFAULT_TRANSFORM
} = require('../utils/designTransform');

test('normalizeTransform falls back to identity for garbage input', () => {
  const t = normalizeTransform({ scale: NaN, rotation: 'abc', offsetX: undefined, brightness: null });
  assert.deepEqual(t, DEFAULT_TRANSFORM);
});

test('normalizeTransform clamps out-of-range values instead of propagating them', () => {
  const t = normalizeTransform({ scale: 9999, offsetX: -50, brightness: 100000 });
  assert.equal(t.scale, 20);
  assert.equal(t.offsetX, -5);
  assert.equal(t.brightness, 300);
});

test('normalizeTransform wraps rotation into 0..360', () => {
  assert.equal(normalizeTransform({ rotation: -90 }).rotation, 270);
  assert.equal(normalizeTransform({ rotation: 450 }).rotation, 90);
});

test('placement is resolution independent - the core preview/print guarantee', () => {
  const transform = { scale: 1.4, rotation: 0, offsetX: 0.12, offsetY: -0.08 };
  const source = { sourceWidth: 4000, sourceHeight: 3000 };

  // A small browser preview and a large print canvas of the SAME aspect ratio.
  const preview = computePlacement({ ...source, areaWidth: 500, areaHeight: 250, transform });
  const print = computePlacement({ ...source, areaWidth: 3000, areaHeight: 1500, transform });

  const ratio = 3000 / 500;
  const eps = 1e-9;

  assert.ok(Math.abs(print.drawWidth - preview.drawWidth * ratio) < eps, 'draw width must scale linearly');
  assert.ok(Math.abs(print.drawHeight - preview.drawHeight * ratio) < eps, 'draw height must scale linearly');
  assert.ok(Math.abs(print.drawX - preview.drawX * ratio) < eps, 'x offset must scale linearly');
  assert.ok(Math.abs(print.drawY - preview.drawY * ratio) < eps, 'y offset must scale linearly');
});

test('scale=1 covers the print area exactly with no bare edges', () => {
  const p = computePlacement({
    sourceWidth: 4000, sourceHeight: 3000,
    areaWidth: 1000, areaHeight: 1000,
    transform: { scale: 1 }
  });
  // "cover" fit: both dimensions must reach or exceed the area.
  assert.ok(p.drawWidth >= 1000 - 1e-9);
  assert.ok(p.drawHeight >= 1000 - 1e-9);
  // ...and one of them should match it exactly (the constraining axis).
  const touches = Math.abs(p.drawHeight - 1000) < 1e-9 || Math.abs(p.drawWidth - 1000) < 1e-9;
  assert.ok(touches, 'cover fit must touch the area on the constraining axis');
});

test('zero offset centres the image', () => {
  const p = computePlacement({
    sourceWidth: 1000, sourceHeight: 1000,
    areaWidth: 600, areaHeight: 400,
    transform: {}
  });
  assert.equal(p.centerX, 300);
  assert.equal(p.centerY, 200);
});

test('offsets pan by a fraction of the print area', () => {
  const p = computePlacement({
    sourceWidth: 1000, sourceHeight: 1000,
    areaWidth: 600, areaHeight: 400,
    transform: { offsetX: 0.5, offsetY: -0.25 }
  });
  assert.equal(p.centerX, 300 + 0.5 * 600);
  assert.equal(p.centerY, 200 - 0.25 * 400);
});

test('computePlacement rejects degenerate dimensions rather than emitting NaN', () => {
  assert.throws(() => computePlacement({
    sourceWidth: 0, sourceHeight: 100, areaWidth: 10, areaHeight: 10, transform: {}
  }), /source dimensions/);
  assert.throws(() => computePlacement({
    sourceWidth: 100, sourceHeight: 100, areaWidth: 0, areaHeight: 10, transform: {}
  }), /area dimensions/);
});

test('legacy pixel-offset records migrate to fractional offsets', () => {
  // 150px on the old fixed 500px preview canvas == 30% of the area.
  const t = fromLegacyImage({ zoom: 2, rotation: 90, position: { x: 150, y: -50 }, brightness: 120 });
  assert.equal(t.scale, 2);
  assert.equal(t.rotation, 90);
  assert.ok(Math.abs(t.offsetX - 0.3) < 1e-9);
  assert.ok(Math.abs(t.offsetY - -0.1) < 1e-9);
  assert.equal(t.brightness, 120);
});

test('an already-canonical record is passed through unchanged by fromLegacyImage', () => {
  const t = fromLegacyImage({ transform: { scale: 1.25, offsetX: 0.2 }, zoom: 99, position: { x: 400 } });
  assert.equal(t.scale, 1.25);
  assert.equal(t.offsetX, 0.2);
});

test('CSS transform uses percentages so it matches computePlacement', () => {
  const css = toCssTransform({ scale: 1.5, rotation: 45, offsetX: 0.1, offsetY: -0.2, brightness: 110, contrast: 90 });
  assert.match(css.transform, /translate\(10%, -20%\)/);
  assert.match(css.transform, /rotate\(45deg\)/);
  assert.match(css.transform, /scale\(1\.5\)/);
  assert.equal(css.filter, 'brightness(110%) contrast(90%)');
});
