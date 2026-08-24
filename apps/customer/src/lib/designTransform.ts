/**
 * Browser mirror of server/utils/designTransform.js.
 *
 * The units here MUST stay identical to the server module - they are the
 * contract that makes "what the customer sees" equal "what gets printed":
 *
 *   scale     multiplier on the cover-fit baseline (1 = exactly fills the area)
 *   offsetX/Y pan as a FRACTION of the print area (0.1 = 10% of its width)
 *   rotation  degrees clockwise about the print-area centre
 *   brightness/contrast  percentages, 100 = unchanged
 *
 * Offsets are fractional rather than pixel-based on purpose: a 150px nudge in
 * a 400px-wide phone preview and in a 3600px print canvas are entirely
 * different shifts, which is exactly how a preview drifts from its print file.
 */

export interface DesignTransform {
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  brightness: number;
  contrast: number;
}

export const IDENTITY_TRANSFORM: DesignTransform = {
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  brightness: 100,
  contrast: 100
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function normalizeTransform(input?: Partial<DesignTransform> | null): DesignTransform {
  const t = input || {};
  return {
    scale: num(t.scale) ? clamp(t.scale, 0.05, 20) : IDENTITY_TRANSFORM.scale,
    rotation: num(t.rotation) ? ((t.rotation % 360) + 360) % 360 : IDENTITY_TRANSFORM.rotation,
    offsetX: num(t.offsetX) ? clamp(t.offsetX, -5, 5) : IDENTITY_TRANSFORM.offsetX,
    offsetY: num(t.offsetY) ? clamp(t.offsetY, -5, 5) : IDENTITY_TRANSFORM.offsetY,
    brightness: num(t.brightness) ? clamp(t.brightness, 10, 300) : IDENTITY_TRANSFORM.brightness,
    contrast: num(t.contrast) ? clamp(t.contrast, 10, 300) : IDENTITY_TRANSFORM.contrast
  };
}

/**
 * CSS for the image layer inside a box already sized to the print area.
 *
 * The layer is sized with object-fit:cover so its baseline matches the
 * server's cover-fit, then translate percentages resolve against that same box
 * - which is what keeps this visually identical to computePlacement().
 */
export function toCssStyle(transform: Partial<DesignTransform> | null | undefined): React.CSSProperties {
  const t = normalizeTransform(transform);
  return {
    transform: `translate(${t.offsetX * 100}%, ${t.offsetY * 100}%) rotate(${t.rotation}deg) scale(${t.scale})`,
    filter: `brightness(${t.brightness}%) contrast(${t.contrast}%)`,
    transformOrigin: 'center'
  };
}

/** Normalised (0..1) print-area rectangle, as served by the template API. */
export interface PrintArea { x: number; y: number; w: number; h: number }

/**
 * Convert the template's normalised print area into CSS percentages, so the
 * overlay lines up with the mockup at any rendered size. No pixel coordinates
 * are hardcoded anywhere in the UI.
 */
export function printAreaStyle(area: PrintArea): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${area.x * 100}%`,
    top: `${area.y * 100}%`,
    width: `${area.w * 100}%`,
    height: `${area.h * 100}%`,
    overflow: 'hidden'
  };
}
