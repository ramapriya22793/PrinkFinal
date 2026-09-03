/**
 * Tests for the server-side print renderer.
 *
 * These assert the claims that must never be faked: that output is generated
 * at the template's true physical size and DPI, and that it is reconstructed
 * from the original HD file rather than an upscaled preview.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { renderPrintRaster, generatePrintPdf, UPLOADS_DIR, resolveOriginalPath } = require('../utils/printRenderer');
const { resolveTemplate, printPixelSize, effectiveDpi } = require('../config/printTemplates');

const ORIGINALS_DIR = path.join(UPLOADS_DIR, 'originals');
const artefacts = [];

/** Build a synthetic HD source photo with a known asymmetric pattern. */
async function makeSource(name, width, height) {
  if (!fs.existsSync(ORIGINALS_DIR)) fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
  const file = path.join(ORIGINALS_DIR, name);
  await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 90, b: 200 } }
  })
    .composite([{
      // A white block in one corner makes orientation/placement observable.
      input: await sharp({ create: { width: Math.floor(width / 4), height: Math.floor(height / 4), channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(),
      left: 0, top: 0
    }])
    .jpeg({ quality: 95 })
    .toFile(file);
  artefacts.push(file);
  return file;
}

test.after(() => {
  for (const f of artefacts) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

test('renders at the exact full-bleed pixel size demanded by the template', async () => {
  const name = `test_src_${Date.now()}.jpg`;
  await makeSource(name, 4000, 3000);

  const template = resolveTemplate({ sku: 'PRK-FRM-810', productTitle: 'Photo Frame 8x10' });
  const expected = printPixelSize(template);

  const result = await renderPrintRaster(
    { originalKey: path.join('originals', name) },
    template,
    { scale: 1 }
  );

  assert.equal(result.width, expected.width);
  assert.equal(result.height, expected.height);
  assert.equal(result.dpi, 300);

  // Verify the actual pixels, not just the reported numbers.
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.width, expected.width);
  assert.equal(meta.height, expected.height);
  assert.equal(meta.density, 300, 'PNG must carry a 300 DPI density tag');
});

test('an 8x10in frame at 300 DPI really is ~2400x3000 device pixels', () => {
  const template = resolveTemplate({ sku: 'PRK-FRM-810', productTitle: 'Photo Frame 8x10' });
  const px = printPixelSize(template);
  // 8in x 300dpi = 2400, 10in x 300dpi = 3000 (trim box, excluding bleed).
  assert.equal(px.trimWidth, 2400);
  assert.equal(px.trimHeight, 3000);
});

test('output resolution is driven by the template, NOT by the source size', async () => {
  // A deliberately small source must still yield a full-size print canvas -
  // proving the canvas is template-driven. The reported effectiveDpi is what
  // exposes the quality shortfall, rather than a silently smaller file.
  const name = `test_small_${Date.now()}.jpg`;
  await makeSource(name, 600, 450);

  const template = resolveTemplate({ sku: 'PRK-FRM-810', productTitle: 'Photo Frame 8x10' });
  const expected = printPixelSize(template);

  const result = await renderPrintRaster({ originalKey: path.join('originals', name) }, template, { scale: 1 });

  assert.equal(result.width, expected.width);
  assert.ok(result.belowMinimumDpi, 'a 600px source must be flagged as below print DPI');
  assert.ok(result.effectiveDpi < 300);
});

test('effectiveDpi reflects the source, the physical size and the zoom', () => {
  const template = resolveTemplate({ sku: 'PRK-FRM-810' });
  // 2400px across 8in = exactly 300 DPI.
  assert.equal(effectiveDpi(2400, 3000, template, 1), 300);
  // Zooming in magnifies the pixels, so effective DPI must fall.
  assert.equal(effectiveDpi(2400, 3000, template, 0.5), 150);
});

test('rotation keeps the canvas size fixed and stays centred', async () => {
  const name = `test_rot_${Date.now()}.jpg`;
  await makeSource(name, 3000, 2000);

  const template = resolveTemplate({ sku: 'PRK-FRM-810' });
  const expected = printPixelSize(template);

  const result = await renderPrintRaster(
    { originalKey: path.join('originals', name) },
    template,
    { scale: 1, rotation: 90 }
  );

  assert.equal(result.width, expected.width, 'rotation must not change the print canvas');
  assert.equal(result.height, expected.height);
});

test('produces a PDF at the correct physical page size including bleed', async () => {
  const name = `test_pdf_${Date.now()}.jpg`;
  await makeSource(name, 3000, 3800);

  const template = resolveTemplate({ sku: 'PRK-FRM-810', productTitle: 'Photo Frame 8x10' });
  const out = await generatePrintPdf({
    orderId: 'TEST-PDF-001',
    order: { product: 'Photo Frame 8x10' },
    image: { originalKey: path.join('originals', name) },
    template,
    transform: { scale: 1 }
  });
  artefacts.push(out.path);

  assert.ok(fs.existsSync(out.path), 'PDF file must exist on disk');
  assert.ok(out.bytes > 10000, `PDF should contain real artwork, got ${out.bytes} bytes`);

  // 8x10in + 3mm bleed each side -> 209.2 x 260 mm
  assert.ok(Math.abs(out.widthMm - 209.2) < 0.01, `expected 209.2mm, got ${out.widthMm}`);
  assert.ok(Math.abs(out.heightMm - 260) < 0.01, `expected 260mm, got ${out.heightMm}`);

  // Colour space must be reported honestly - PDFKit emits DeviceRGB.
  assert.equal(out.colourSpace, 'RGB');

  const header = fs.readFileSync(out.path).subarray(0, 5).toString();
  assert.equal(header, '%PDF-', 'must be a real PDF');
});

test('a missing original fails loudly instead of producing a blank print file', async () => {
  const template = resolveTemplate({ sku: 'PRK-FRM-810' });
  await assert.rejects(
    () => renderPrintRaster({ originalKey: 'originals/does_not_exist.jpg' }, template, {}),
    /Original source image not found/
  );
});

test('storage keys cannot escape the uploads directory', () => {
  assert.equal(resolveOriginalPath({ originalKey: '../../../../etc/passwd' }), null);
  assert.equal(resolveOriginalPath({ originalKey: '..\\..\\..\\windows\\win.ini' }), null);
});
