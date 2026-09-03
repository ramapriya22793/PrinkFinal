/**
 * THE PRINK - Canonical design transformation model.
 *
 * Requirement: "Customer preview = Admin preview = Print output".
 *
 * The only way to guarantee that is to have exactly ONE definition of what a
 * transform means, expressed in resolution-independent units, and to derive
 * every rendering (browser preview, admin preview, 300-DPI print raster) from
 * it by scaling to the target canvas.
 *
 * Units
 * -----
 *  scale     multiplier applied to the "cover" baseline fit (1 = exactly fills
 *            the print area, 2 = twice that size). NOT a pixel value.
 *  offsetX/Y pan expressed as a FRACTION OF THE PRINT AREA (0.1 = shift by 10%
 *            of the print-area width). Pixel offsets were the previous model
 *            and are resolution dependent - a 150px nudge in a 500px browser
 *            preview is a completely different shift on a 3600px print canvas,
 *            which is precisely how preview and print drift apart.
 *  rotation  degrees, clockwise, about the centre of the print area.
 *  brightness/contrast  percentages, 100 = unchanged (matches CSS filter()).
 *
 * This module is pure arithmetic with no I/O and no dependencies so it can be
 * unit tested directly and mirrored exactly by the frontend.
 */

const DEFAULT_TRANSFORM = Object.freeze({
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  brightness: 100,
  contrast: 100
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/**
 * Coerce arbitrary/legacy stored data into a valid canonical transform.
 * Unknown or out-of-range values fall back to the identity transform rather
 * than propagating NaN into a print job.
 */
function normalizeTransform(input = {}) {
  const t = input || {};
  return {
    scale: isFiniteNumber(t.scale) ? clamp(t.scale, 0.05, 20) : DEFAULT_TRANSFORM.scale,
    rotation: isFiniteNumber(t.rotation) ? ((t.rotation % 360) + 360) % 360 : DEFAULT_TRANSFORM.rotation,
    offsetX: isFiniteNumber(t.offsetX) ? clamp(t.offsetX, -5, 5) : DEFAULT_TRANSFORM.offsetX,
    offsetY: isFiniteNumber(t.offsetY) ? clamp(t.offsetY, -5, 5) : DEFAULT_TRANSFORM.offsetY,
    brightness: isFiniteNumber(t.brightness) ? clamp(t.brightness, 10, 300) : DEFAULT_TRANSFORM.brightness,
    contrast: isFiniteNumber(t.contrast) ? clamp(t.contrast, 10, 300) : DEFAULT_TRANSFORM.contrast
  };
}

/**
 * Migrate a legacy image record (pixel `position`, `zoom`) to the canonical
 * model. Legacy pixel offsets were authored against the old fixed 500px
 * preview canvas, so they are converted to fractions using that reference.
 * Without this, existing saved designs would silently shift when re-rendered.
 */
const LEGACY_PREVIEW_CANVAS_PX = 500;

function fromLegacyImage(img = {}) {
  if (!img) return { ...DEFAULT_TRANSFORM };
  if (img.transform) return normalizeTransform(img.transform);

  return normalizeTransform({
    scale: isFiniteNumber(img.zoom) ? img.zoom : 1,
    rotation: isFiniteNumber(img.rotation) ? img.rotation : 0,
    offsetX: isFiniteNumber(img.position?.x) ? img.position.x / LEGACY_PREVIEW_CANVAS_PX : 0,
    offsetY: isFiniteNumber(img.position?.y) ? img.position.y / LEGACY_PREVIEW_CANVAS_PX : 0,
    brightness: isFiniteNumber(img.brightness) ? img.brightness : 100,
    contrast: isFiniteNumber(img.contrast) ? img.contrast : 100
  });
}

/**
 * Compute where the source image must be drawn, in pixels, for a print area of
 * `areaWidth` x `areaHeight` on the target canvas.
 *
 * The baseline is a "cover" fit (the image fully covers the print area with no
 * empty edges), which is then multiplied by `scale` and panned by the offsets.
 * Because every term is proportional to the print-area size, the same
 * transform produces a geometrically identical result at any resolution.
 *
 * @returns {{drawWidth:number, drawHeight:number, drawX:number, drawY:number,
 *            centerX:number, centerY:number, rotation:number}}
 *          drawX/drawY are the top-left corner relative to the print area
 *          origin, before rotation about (centerX, centerY).
 */
function computePlacement({ sourceWidth, sourceHeight, areaWidth, areaHeight, transform }) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    throw new Error('computePlacement: source dimensions must be positive');
  }
  if (!(areaWidth > 0 && areaHeight > 0)) {
    throw new Error('computePlacement: area dimensions must be positive');
  }

  const t = normalizeTransform(transform);

  // "cover" baseline: the larger of the two ratios guarantees full coverage.
  const coverRatio = Math.max(areaWidth / sourceWidth, areaHeight / sourceHeight);
  const finalRatio = coverRatio * t.scale;

  const drawWidth = sourceWidth * finalRatio;
  const drawHeight = sourceHeight * finalRatio;

  // Centre the image in the area, then pan by a fraction of the area size.
  const centerX = areaWidth / 2 + t.offsetX * areaWidth;
  const centerY = areaHeight / 2 + t.offsetY * areaHeight;

  return {
    drawWidth,
    drawHeight,
    drawX: centerX - drawWidth / 2,
    drawY: centerY - drawHeight / 2,
    centerX,
    centerY,
    rotation: t.rotation
  };
}

/**
 * CSS representation of the same transform, for the browser preview.
 * Kept here so the preview and the renderer are edited together.
 */
function toCssTransform(transform) {
  const t = normalizeTransform(transform);
  return {
    // Percentages resolve against the element's own box, which the preview
    // sizes to the print area - so this matches computePlacement exactly.
    transform: `translate(${t.offsetX * 100}%, ${t.offsetY * 100}%) rotate(${t.rotation}deg) scale(${t.scale})`,
    filter: `brightness(${t.brightness}%) contrast(${t.contrast}%)`
  };
}

module.exports = {
  DEFAULT_TRANSFORM,
  LEGACY_PREVIEW_CANVAS_PX,
  normalizeTransform,
  fromLegacyImage,
  computePlacement,
  toCssTransform
};
