import React from 'react';

interface CropData {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

interface ButterflySheetProps {
  images: any[];
  butterflyCrops: Record<number, CropData>;
  orderId?: string;
  onSelectPhoto?: (idx: number) => void;
  forPdf?: boolean;
}

export const ButterflySheet: React.FC<ButterflySheetProps> = ({ images, butterflyCrops, orderId, onSelectPhoto, forPdf }) => {
  // Exact Technical Blueprint Coordinates (in mm)
  const p1_small = [
    { x: 13.10, y: 36.60 },
    { x: 90.10, y: 36.60 },
    { x: 167.10, y: 36.60 },
    { x: 244.10, y: 36.60 }
  ];
  const p1_large = [
    { x: 13.10, y: 132.60 },
    { x: 13.10, y: 217.60 },
    { x: 13.10, y: 302.60 },
    { x: 13.10, y: 387.60 }
  ];
  const p2_large = [
    { x: 159.10, y: 132.60 },
    { x: 159.10, y: 217.60 },
    { x: 159.10, y: 302.60 },
    { x: 159.10, y: 387.60 }
  ];
  const p2_small = [
    { x: 244.10, y: 164.60 },
    { x: 244.10, y: 241.60 },
    { x: 244.10, y: 318.60 },
    { x: 244.10, y: 395.60 }
  ];

  const renderBox = (idx: number, x: number, y: number, size: number, color: string, showPhoto: boolean = true) => {
    const crop = butterflyCrops[idx] || { scale: 1, rotation: 0, x: 0, y: 0 };
    const img = (images || [])[idx];
    
    return (
      <div 
        key={idx + '-' + x} 
        style={{ position: 'absolute', left: x + 'mm', top: y + 'mm', cursor: onSelectPhoto ? 'pointer' : 'default' }}
        onClick={() => onSelectPhoto && onSelectPhoto(idx)}
      >
        <div style={{ width: size + 'mm', height: size + 'mm', border: `${size === 81 ? 1 : 0.8}mm solid ${color}`, background: '#ffffff', overflow: 'hidden', position: 'relative' }}>
          {showPhoto ? (
            <div style={{ width: '100%', height: '100%', position: 'absolute', left: 0, top: 0, overflow: 'hidden' }}>
              {img ? (
                forPdf ? (
                  <div style={{
                    position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                    backgroundImage: `url(${img.src || img.url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: `${50 + crop.x}% ${50 + crop.y}%`,
                    transformOrigin: 'center',
                    transform: `scale(${crop.scale}) rotate(${crop.rotation}deg)`
                  }} />
                ) : (
                  <img 
                    src={img.src || img.url}
                    crossOrigin="anonymous"
                    style={{
                      position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                      objectFit: 'cover',
                      objectPosition: `${50 + crop.x}% ${50 + crop.y}%`,
                      transformOrigin: 'center',
                      transform: `scale(${crop.scale}) rotate(${crop.rotation}deg)`
                    }} 
                  />
                )
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 600 }}>Photo {idx + 1}</span>
                </div>
              )}
            </div>
          ) : (
             <div style={{ width: '100%', height: '100%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '9px', color: '#cbd5e1', fontWeight: 600 }}>[Order 2 Slot]</span>
             </div>
          )}
        </div>
      </div>
    );
  };

  const orderNum = orderId ? orderId.replace(/[^0-9]/g, '').slice(-6) || orderId.split('-')[0] : '000001';
  const orderLabel = `Bt ${orderNum}`;

  return (
    <div 
      id="butterfly-sheet-layout"
      style={{
        width: '330.2mm',
        height: '482.6mm',
        background: '#ffffff',
        position: 'relative',
        boxSizing: 'border-box',
        margin: '0 auto',
        overflow: 'hidden',
        boxShadow: '0 0 20px rgba(0,0,0,0.1)'
      }}
    >
      {/* Green Cut Line (Sheet Perimeter) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '0.6mm solid #00963f', pointerEvents: 'none', zIndex: 5 }} />
      {/* Red Safe Margin (320.2 x 460.1 mm) */}
      <div style={{ position: 'absolute', top: '17.45mm', left: '5mm', width: '320.2mm', height: '460.1mm', border: '0.4mm solid #e3000f', pointerEvents: 'none', zIndex: 5 }} />
      
      {/* Registration & Trim Marks */}
      <div style={{ position: 'absolute', left: '5mm', top: '457.6mm', width: '0.4mm', height: '20mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '5mm', top: '476.6mm', width: '20mm', height: '0.4mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '324.2mm', top: '457.6mm', width: '0.4mm', height: '20mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '305.2mm', top: '476.6mm', width: '20mm', height: '0.4mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '5mm', top: '55mm', width: '0.4mm', height: '20mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '5mm', top: '64mm', width: '5mm', height: '0.4mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '324.2mm', top: '55mm', width: '0.4mm', height: '20mm', background: '#18181b' }} />
      <div style={{ position: 'absolute', left: '320.2mm', top: '64mm', width: '5mm', height: '0.4mm', background: '#18181b' }} />

      {/* Product 1 Barcode Box */}
      <div style={{ position: 'absolute', left: '98.78mm', top: '116.6mm', width: '52.92mm', height: '12.5mm', border: '0.8mm solid #0000ff', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '8px', fontWeight: 700, color: '#000' }}>||||| {orderLabel} |||||</span>
      </div>
      {/* Product 1 Order ID Text */}
      <div style={{ position: 'absolute', left: '16.63mm', top: '120mm', fontSize: '11px', fontWeight: 800, color: '#000' }}>{orderLabel}</div>
      <div style={{ position: 'absolute', left: '65mm', top: '120mm', fontSize: '11px', fontWeight: 800, color: '#000' }}>{orderLabel}</div>

      {/* Product 2 Barcode Box */}
      <div style={{ position: 'absolute', left: '252.58mm', top: '130.53mm', width: '52.89mm', height: '12.5mm', border: '0.8mm solid #ff0000', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '8px', fontWeight: 700, color: '#000' }}>[Order 2 Barcode]</span>
      </div>

      {/* P1 Large (Photos 0..3) */}
      {p1_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#0000ff', true))}
      {/* P1 Small (Photos 4..7) */}
      {p1_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#0000ff', true))}

      {/* P2 Large (Order 2) */}
      {p2_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#ff0000', false))}
      {/* P2 Small (Order 2) */}
      {p2_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#ff0000', false))}
    </div>
  );
};
