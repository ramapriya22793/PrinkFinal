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
  const p1_small = [
    { x: 9, y: 14 },
    { x: 84, y: 14 },
    { x: 159, y: 14 },
    { x: 234, y: 14 }
  ];
  const p1_large = [
    { x: 9, y: 100 },
    { x: 9, y: 183 },
    { x: 9, y: 266 },
    { x: 9, y: 349 }
  ];
  const p2_large = [
    { x: 155, y: 100 },
    { x: 155, y: 183 },
    { x: 155, y: 266 },
    { x: 155, y: 349 }
  ];
  const p2_small = [
    { x: 241, y: 120 },
    { x: 241, y: 195 },
    { x: 241, y: 270 },
    { x: 241, y: 345 }
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
        <div style={{ width: size + 'mm', height: size + 'mm', border: `1mm solid ${color}`, background: '#f8fafc', overflow: 'hidden', position: 'relative' }}>
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
                <div style={{ width: '100%', height: '100%', background: '#f1f5f9' }} />
              )}
            </div>
          ) : (
             <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '10px', color: '#cbd5e1', fontWeight: 600 }}>EMPTY</span>
             </div>
          )}
        </div>
      </div>
    );
  };

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
      {/* Green Cut Line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '0.5mm solid #22c55e', pointerEvents: 'none', zIndex: 5 }} />
      {/* Red Safe Margin */}
      <div style={{ position: 'absolute', top: '11.25mm', left: '5mm', right: '5mm', bottom: '11.25mm', border: '0.5mm solid #ef4444', pointerEvents: 'none', zIndex: 5 }} />
      
      {/* Labels */}
      <div style={{ position: 'absolute', left: '10mm', top: '2mm', fontSize: '12px', fontWeight: 800, color: '#1e3a8a' }}>Order: {orderId ? orderId.split('-')[0] : 'Bt 000001'}</div>
      <div style={{ position: 'absolute', left: '155mm', top: '2mm', fontSize: '12px', fontWeight: 800, color: '#000', whiteSpace: 'nowrap' }}>Butterfly Box Print Template</div>
      <div style={{ position: 'absolute', left: '260mm', top: '2mm', fontSize: '12px', fontWeight: 800, color: '#ef4444' }}>{orderId ? orderId.split('-')[0] : 'Bt 000001'}</div>

      {/* Blue / Red blocks from the template */}
      <div style={{ position: 'absolute', left: '10mm', top: '90mm', width: '30mm', height: '6mm', border: '0.5mm solid #2563eb' }} />
      <div style={{ position: 'absolute', left: '260mm', top: '105mm', width: '30mm', height: '6mm', border: '0.5mm solid #dc2626' }} />

      {/* Labels between blocks */}
      <div style={{ position: 'absolute', left: '105mm', top: '130mm', fontSize: '10px', fontWeight: 700, color: '#1e3a8a' }}>65 mm</div>

      {/* P1 Large */}
      {p1_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#2563eb', true))}
      {/* P2 Large */}
      {p2_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#dc2626', false))}
      {/* P1 Small */}
      {p1_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#2563eb', true))}
      {/* P2 Small */}
      {p2_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#dc2626', false))}
    </div>
  );
};
