import React from 'react';

interface CropData {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

interface PolaroidSheetProps {
  images: any[];
  polaroidCrops?: Record<number, CropData>;
  orderId?: string;
  onSelectPhoto?: (idx: number) => void;
  forPdf?: boolean;
}

/**
 * Exact Technical Blueprint & Production Sample Specifications:
 * Sheet Width: 330.148 mm (Super B / 13 inch photo paper)
 * Sheet Height: 498.900 mm (24.966 top + 457.200 grid + 16.734 bottom)
 * Red Cut Boundary: 304.799 mm x 457.200 mm (12.0 x 18.0 inches)
 * Grid: 4 columns x 5 rows = 20 polaroid cards
 * Card Width: 69.916 mm
 * Column Gap: 6.284 mm
 * Column Pitch: 76.200 mm (3.0 inches = 69.916 card + 6.284 gap)
 * Outer Left Gutter: 3.142 mm, Outer Right Gutter: 3.142 mm
 * Card Height: 91.440 mm (3.6 inches = 71.162 photo + 20.278 chin)
 * Row Gap: 0 mm (rows touch chin-to-top)
 * Side Margins (Sheet Left & Right): (330.148 - 304.799) / 2 = 12.6745 mm
 * Top Margin to Grid: 24.966 mm
 * Bottom Margin from Grid: 16.734 mm
 * Barcode Box: 30.000 mm x 11.681 mm (4 header boxes, 1 per column)
 * Order Number Label: Bold text beside each barcode box
 */
export const PolaroidSheet: React.FC<PolaroidSheetProps> = ({
  images,
  polaroidCrops = {},
  orderId = 'ORDER',
  onSelectPhoto,
  forPdf
}) => {
  const cleanId = String(orderId).replace(/^#/, '');
  const baseOrder = cleanId.split('-')[0];
  const orderLabel = `${baseOrder}-1`;

  const COLS = 4;
  const ROWS = 5;
  const CARD_W = 69.916; // mm
  const PHOTO_H = 71.162; // mm
  const CHIN_H = 20.278; // mm
  const CARD_H = 91.440; // mm

  const COL_GAP = 6.284; // mm
  const COL_PITCH = 76.200; // mm
  const HALF_GAP = 3.142; // mm

  const GRID_W = 304.799; // mm
  const GRID_H = 457.200; // mm

  const MARGIN_X = 12.6745; // mm
  const GRID_START_Y = 24.966; // mm

  const BARCODE_W = 30.000; // mm
  const BARCODE_H = 11.681; // mm

  return (
    <div
      id="polaroid-sheet-layout"
      style={{
        width: '330.148mm',
        height: '498.900mm',
        background: '#ffffff',
        position: 'relative',
        boxSizing: 'border-box',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      {/* ── 1. Top Barcode Header: 4 Boxes Above the 4 Columns ── */}
      {Array.from({ length: COLS }).map((_, c) => {
        const cardLeft = MARGIN_X + HALF_GAP + (c * COL_PITCH);
        const boxY = GRID_START_Y - BARCODE_H - 4.5; // mm

        return (
          <React.Fragment key={`barcode-header-${c}`}>
            {/* Barcode box */}
            <div
              style={{
                position: 'absolute',
                left: `${cardLeft}mm`,
                top: `${boxY}mm`,
                width: `${BARCODE_W}mm`,
                height: `${BARCODE_H}mm`,
                border: '0.35mm solid #000000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1mm 1.5mm',
                boxSizing: 'border-box',
                background: '#ffffff'
              }}
            >
              {/* Barcode representation */}
              <div style={{ display: 'flex', gap: '0.32mm', height: '100%', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                {[2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 2, 3, 1, 2, 1, 3, 1].map((w, bi) => (
                  <div
                    key={bi}
                    style={{
                      width: `${w * 0.22}mm`,
                      height: '85%',
                      background: '#000000'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Order No Text directly to the right of the barcode box */}
            <div
              style={{
                position: 'absolute',
                left: `${cardLeft + BARCODE_W + 2.5}mm`,
                top: `${boxY + 2.5}mm`,
                fontSize: '11px',
                fontWeight: 800,
                color: '#000000',
                letterSpacing: '0.3px',
                fontFamily: 'Helvetica, Arial, sans-serif'
              }}
            >
              {orderLabel}
            </div>
          </React.Fragment>
        );
      })}

      {/* ── 2. Page Number Tag (Right Margin) ── */}
      <div
        style={{
          position: 'absolute',
          left: `${MARGIN_X + GRID_W + 5.0}mm`,
          top: `${GRID_START_Y + 12.0}mm`,
          transform: 'rotate(90deg)',
          transformOrigin: 'left top',
          fontSize: '9px',
          fontWeight: 800,
          color: '#000000',
          letterSpacing: '0.5px',
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}
      >
        P.No. : 1
      </div>

      {/* ── 3. Registration Cut Marks ── */}
      {/* 3a. Grid Intersection Crosshairs (+) at column and row dividers */}
      {Array.from({ length: COLS - 1 }).map((_, c) => {
        const x = MARGIN_X + ((c + 1) * COL_PITCH);
        return Array.from({ length: ROWS - 1 }).map((_, r) => {
          const y = GRID_START_Y + ((r + 1) * CARD_H);
          return (
            <div
              key={`cross-${c}-${r}`}
              style={{
                position: 'absolute',
                left: `${x}mm`,
                top: `${y}mm`,
                pointerEvents: 'none',
                zIndex: 20
              }}
            >
              <div style={{ position: 'absolute', left: '-3mm', top: '0mm', width: '6mm', height: '0.3mm', background: '#000000' }} />
              <div style={{ position: 'absolute', left: '0mm', top: '-3mm', width: '0.3mm', height: '6mm', background: '#000000' }} />
            </div>
          );
        });
      })}

      {/* 3b. Four Corner Crop Marks (L) */}
      {/* Top-Left */}
      <div style={{ position: 'absolute', left: `${MARGIN_X}mm`, top: `${GRID_START_Y}mm`, pointerEvents: 'none', zIndex: 20 }}>
        <div style={{ position: 'absolute', left: '-4mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        <div style={{ position: 'absolute', left: '0mm', top: '-4mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
      </div>
      {/* Top-Right */}
      <div style={{ position: 'absolute', left: `${MARGIN_X + GRID_W}mm`, top: `${GRID_START_Y}mm`, pointerEvents: 'none', zIndex: 20 }}>
        <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        <div style={{ position: 'absolute', left: '0mm', top: '-4mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
      </div>
      {/* Bottom-Left */}
      <div style={{ position: 'absolute', left: `${MARGIN_X}mm`, top: `${GRID_START_Y + GRID_H}mm`, pointerEvents: 'none', zIndex: 20 }}>
        <div style={{ position: 'absolute', left: '-4mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
      </div>
      {/* Bottom-Right */}
      <div style={{ position: 'absolute', left: `${MARGIN_X + GRID_W}mm`, top: `${GRID_START_Y + GRID_H}mm`, pointerEvents: 'none', zIndex: 20 }}>
        <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
      </div>

      {/* 3c. Perimeter Edge T-Marks */}
      {/* Top dividers */}
      {Array.from({ length: COLS - 1 }).map((_, c) => (
        <div key={`top-t-${c}`} style={{ position: 'absolute', left: `${MARGIN_X + ((c + 1) * COL_PITCH)}mm`, top: `${GRID_START_Y}mm`, pointerEvents: 'none', zIndex: 20 }}>
          <div style={{ position: 'absolute', left: '0mm', top: '-4mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
          <div style={{ position: 'absolute', left: '-2mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        </div>
      ))}
      {/* Bottom dividers */}
      {Array.from({ length: COLS - 1 }).map((_, c) => (
        <div key={`bot-t-${c}`} style={{ position: 'absolute', left: `${MARGIN_X + ((c + 1) * COL_PITCH)}mm`, top: `${GRID_START_Y + GRID_H}mm`, pointerEvents: 'none', zIndex: 20 }}>
          <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
          <div style={{ position: 'absolute', left: '-2mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
        </div>
      ))}
      {/* Left dividers */}
      {Array.from({ length: ROWS - 1 }).map((_, r) => (
        <div key={`left-t-${r}`} style={{ position: 'absolute', left: `${MARGIN_X}mm`, top: `${GRID_START_Y + ((r + 1) * CARD_H)}mm`, pointerEvents: 'none', zIndex: 20 }}>
          <div style={{ position: 'absolute', left: '-4mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
          <div style={{ position: 'absolute', left: '0mm', top: '-2mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
        </div>
      ))}
      {/* Right dividers */}
      {Array.from({ length: ROWS - 1 }).map((_, r) => (
        <div key={`right-t-${r}`} style={{ position: 'absolute', left: `${MARGIN_X + GRID_W}mm`, top: `${GRID_START_Y + ((r + 1) * CARD_H)}mm`, pointerEvents: 'none', zIndex: 20 }}>
          <div style={{ position: 'absolute', left: '0mm', top: '0mm', width: '4mm', height: '0.35mm', background: '#000000' }} />
          <div style={{ position: 'absolute', left: '0mm', top: '-2mm', width: '0.35mm', height: '4mm', background: '#000000' }} />
        </div>
      ))}

      {/* ── 4. 4x5 Grid of 20 Polaroid Cards ── */}
      {Array.from({ length: ROWS }).map((_, r) => {
        return Array.from({ length: COLS }).map((_, c) => {
          const idx = r * COLS + c;
          const img = (images || [])[idx];
          const crop = polaroidCrops[idx] || { scale: 1, rotation: 0, x: 0, y: 0 };
          const caption = (img?.caption || img?.text || img?.title || '').trim();

          const cardX = MARGIN_X + HALF_GAP + (c * COL_PITCH);
          const cardY = GRID_START_Y + (r * CARD_H);

          return (
            <div
              key={`polaroid-card-${idx}`}
              onClick={() => onSelectPhoto && onSelectPhoto(idx)}
              style={{
                position: 'absolute',
                left: `${cardX}mm`,
                top: `${cardY}mm`,
                width: `${CARD_W}mm`,
                height: `${CARD_H}mm`,
                boxSizing: 'border-box',
                background: '#ffffff',
                cursor: onSelectPhoto ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transition: 'outline 0.15s ease'
              }}
              className="hover:outline hover:outline-2 hover:outline-indigo-500"
              title={`Polaroid Card ${idx + 1}`}
            >
              {/* Photo Area (69.916 mm x 71.162 mm, 0 inner border) */}
              <div
                style={{
                  width: `${CARD_W}mm`,
                  height: `${PHOTO_H}mm`,
                  background: '#f1f5f9',
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {img ? (
                  forPdf ? (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: '100%',
                        height: '100%',
                        backgroundImage: `url(${img.src || img.url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: `${50 + crop.x}% ${50 + crop.y}%`,
                        transformOrigin: 'center',
                        transform: `scale(${crop.scale}) rotate(${crop.rotation}deg)`
                      }}
                    />
                  ) : (
                    <img
                      src={img.src || img.url}
                      crossOrigin="anonymous"
                      alt={`Polaroid ${idx + 1}`}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: `${50 + crop.x}% ${50 + crop.y}%`,
                        transformOrigin: 'center',
                        transform: `scale(${crop.scale}) rotate(${crop.rotation}deg)`
                      }}
                    />
                  )
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      fontSize: '9px',
                      fontWeight: 600
                    }}
                  >
                    <span>Card #{idx + 1}</span>
                    <span style={{ fontSize: '8px', opacity: 0.7 }}>Empty</span>
                  </div>
                )}
              </div>

              {/* Bottom Caption Chin (20.278 mm) */}
              <div
                style={{
                  width: '100%',
                  height: `${CHIN_H}mm`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1mm 2mm',
                  boxSizing: 'border-box',
                  background: '#ffffff'
                }}
              >
                {caption ? (
                  <span
                    style={{
                      fontFamily: '"Caveat", "Dancing Script", "Brush Script MT", cursive, serif',
                      fontSize: '12px',
                      color: '#1e293b',
                      textAlign: 'center',
                      lineHeight: '1.2',
                      maxHeight: '16mm',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}
                  >
                    {caption}
                  </span>
                ) : (
                  <span style={{ fontSize: '7.5px', color: '#cbd5e1', fontStyle: 'italic' }}>
                    Photo {idx + 1}
                  </span>
                )}
              </div>
            </div>
          );
        });
      })}
    </div>
  );
};
