import React from 'react';

interface CropData {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

interface MagazineSheetProps {
  images: any[];
  magazineCrops: Record<number, CropData>;
  orderId?: string;
  onSelectPhoto?: (idx: number) => void;
  forPdf?: boolean;
}

export const MagazineSheet: React.FC<MagazineSheetProps> = ({ images, magazineCrops, orderId, onSelectPhoto, forPdf }) => {
  // We center the boxes vertically and horizontally within each half to match the proportions
  const coords = [
    { x: 15, y: 19 },
    { x: 135, y: 19 },
    { x: 265.6, y: 19 },
    { x: 385.6, y: 19 },
    { x: 15, y: 181.2 },
    { x: 135, y: 181.2 },
    { x: 265.6, y: 181.2 },
    { x: 385.6, y: 181.2 }
  ];

  const renderBox = (idx: number, x: number, y: number, color: string) => {
    // 4 Photo Uploading -> Duplicate across 8 frames
    const imageIdx = idx % 4; // 0,1,2,3 map to 0,1,2,3; 4,5,6,7 map to 0,1,2,3
    const crop = magazineCrops[imageIdx] || { scale: 1, rotation: 0, x: 0, y: 0 };
    // Box dimensions: 80x130
    const boxW = 80;
    const boxH = 130;
    
    const ratioX = 80 / 140; 
    const ratio = ratioX;

    const img = (images || [])[imageIdx];
    
    return (
      <div 
        key={idx + '-' + x} 
        style={{ position: 'absolute', left: x + 'px', top: y + 'px', cursor: onSelectPhoto ? 'pointer' : 'default' }}
        onClick={() => onSelectPhoto && onSelectPhoto(idx)}
      >
        {/* Label positioned OUTSIDE the photo frame */}
        <div style={{ position: 'absolute', top: '-11px', left: 0, width: '100%', textAlign: 'center', fontSize: '8px', color: color, fontWeight: 700 }}>
          Photo {imageIdx + 1}
        </div>

        <div style={{ width: boxW + 'px', height: boxH + 'px', border: `1.5px solid ${color}`, background: '#f8fafc', overflow: 'hidden', position: 'relative', borderRadius: '4px' }}>
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
              <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 600 }}>EMPTY</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      id="magazine-sheet-layout"
      style={{
        width: '482.6px',
        height: '330.2px',
        background: '#ffffff',
        position: 'relative',
        boxSizing: 'border-box'
      }}
    >
      {/* Green Cut Line (Sheet bounds) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '1px solid #22c55e', pointerEvents: 'none', zIndex: 5 }} />
      {/* Center Line Fold / Divider */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '241.3px', borderLeft: '1px dashed #94a3b8', pointerEvents: 'none', zIndex: 5 }} />
      
      {/* Labels placed completely outside the Red Safe Margin at the top edge */}
      <div style={{ position: 'absolute', left: '14px', top: '3px', fontSize: '8px', fontWeight: 800, color: '#1e3a8a' }}>Order: {orderId ? orderId.split('-')[0] : 'Mg 000001'}</div>
      <div style={{ position: 'absolute', left: '210px', top: '3px', fontSize: '8px', fontWeight: 800, color: '#000', whiteSpace: 'nowrap' }}>Magazine Print Template (19"x13")</div>
      <div style={{ position: 'absolute', left: '400px', top: '3px', fontSize: '8px', fontWeight: 800, color: '#ef4444' }}>{orderId ? orderId.split('-')[0] : 'Mg 000001'}</div>

      {/* Render 8 boxes */}
      {coords.map((c, i) => renderBox(i, c.x, c.y, '#2563eb'))}
    </div>
  );
};
