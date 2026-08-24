import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Order {
  id: string;
  customerName?: string;
  product?: string;
  productType?: string;
  customizationStatus?: string;
  uploadedImageUrl?: string;
  designData?: string;
  [key: string]: any;
}

interface CanvasElement {
  id: string;
  type: 'image' | 'text' | 'shape' | 'sticker';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  // image props
  src?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  grayscale?: boolean;
  sepia?: number;
  flipX?: boolean;
  flipY?: boolean;
  // text props
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textAlign?: string;
  // shape props
  shapeType?: 'circle' | 'rect' | 'triangle' | 'star';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

interface AdminDesignEditorProps {
  order: Order;
  linkedOrder?: Order;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRequestReupload: () => void;
  onCommentsChange: (txt: string) => void;
  commentsValue: string;
  onSaveProgress: (elements: CanvasElement[]) => void;
}

const OVERLAYS = [
  { id: 'confetti', name: 'Confetti' },
  { id: 'bokeh', name: 'Bokeh Circles' },
  { id: 'vignette', name: 'Vignette' },
  { id: 'gold-border', name: 'Gold Border' },
  { id: 'film-grain', name: 'Film Grain' },
];

const STICKER_EMOJIS = ['❤️', '⭐', '✨', '🌸', '🎨', '🎭', '🦋', '🌈', '🎉', '💎'];

const AdminDesignEditor: React.FC<AdminDesignEditorProps> = ({
  order,
  linkedOrder,
  onClose,
  onApprove,
  onReject,
  onRequestReupload,
  onCommentsChange,
  commentsValue,
  onSaveProgress,
}) => {
  const isButterfly = (order.productType || order.product || '').toLowerCase().includes('butterfly');

  // Butterfly Box states
  const [activeButterflyIndex, setActiveButterflyIndex] = useState(0);
  const [butterflyCrops, setButterflyCrops] = useState<Record<number, { scale: number, rotation: number, x: number, y: number }>>(() => {
    if (isButterfly && order.designData) {
      try {
        const parsed = JSON.parse(order.designData);
        if (parsed.butterflyCrops) return parsed.butterflyCrops;
      } catch {}
    }
    return {
      0: { scale: 1, rotation: 0, x: 0, y: 0 },
      1: { scale: 1, rotation: 0, x: 0, y: 0 },
      2: { scale: 1, rotation: 0, x: 0, y: 0 },
      3: { scale: 1, rotation: 0, x: 0, y: 0 },
      4: { scale: 1, rotation: 0, x: 0, y: 0 },
      5: { scale: 1, rotation: 0, x: 0, y: 0 },
      6: { scale: 1, rotation: 0, x: 0, y: 0 },
      7: { scale: 1, rotation: 0, x: 0, y: 0 }
    };
  });

  const [photoScale, setPhotoScale] = useState(1);
  const [photoRotation, setPhotoRotation] = useState(0);
  const [photoOffsetX, setPhotoOffsetX] = useState(0);
  const [photoOffsetY, setPhotoOffsetY] = useState(0);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const photoOffsetStart = useRef({ x: 0, y: 0 });
  const [livePreviewPhoto, setLivePreviewPhoto] = useState<string>('');
  const [butterflyPreviewMode, setButterflyPreviewMode] = useState<'sheet' | 'mockup'>('mockup');

  useEffect(() => {
    if (isButterfly && order.images && order.images.length > 0) {
      const firstImg = order.images[0].src || order.images[0].url || '';
      setLivePreviewPhoto(firstImg);
      const crop = butterflyCrops[0] || { scale: 1, rotation: 0, x: 0, y: 0 };
      setPhotoScale(crop.scale);
      setPhotoRotation(crop.rotation);
      setPhotoOffsetX(crop.x);
      setPhotoOffsetY(crop.y);
    }
  }, [isButterfly, order.images]);

  const renderButterflySheet = (isReview = false) => {
    const p1_small = [
      { x: 14, y: 22.35 },
      { x: 93, y: 22.35 },
      { x: 172, y: 22.35 },
      { x: 251, y: 22.35 }
    ];
    const p1_large = [
      { x: 14, y: 118.35 },
      { x: 14, y: 209.01 },
      { x: 14, y: 299.67 },
      { x: 14, y: 390.33 }
    ];
    const p2_large = [
      { x: 160, y: 118.35 },
      { x: 160, y: 209.01 },
      { x: 160, y: 299.67 },
      { x: 160, y: 390.33 }
    ];
    const p2_small = [
      { x: 251, y: 150.37 },
      { x: 251, y: 233.03 },
      { x: 251, y: 315.69 },
      { x: 251, y: 398.35 }
    ];

const renderBox = (idx: number, x: number, y: number, size: number, color: string, orderSource: any = null) => {
      if (idx === 0) console.log("RENDER BOX CALL! color:", color, "orderSource images:", orderSource ? (orderSource.images ? orderSource.images.length : 0) : "NULL");
      const crop = butterflyCrops[idx] || { scale: 1, rotation: 0, x: 0, y: 0 };
      const ratio = size / 140;
      const isActive = !isReview && activeButterflyIndex === idx && !!orderSource;
      return (
        <div key={idx + '-' + x} style={{ position: 'absolute', left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', border: `1.5px solid ${color}`, background: '#f8fafc', overflow: 'hidden' }}>
          {orderSource ? (
            <div onClick={() => !isReview && changeActiveButterflyPhoto(idx)} style={{ width: '100%', height: '100%', position: 'absolute', left: 0, top: 0, cursor: isReview ? 'default' : 'pointer', outline: isActive ? `2px solid ${color}` : 'none', outlineOffset: '-2px', zIndex: isActive ? 10 : 1, overflow: 'hidden' }}>
              {(orderSource.images || [])[idx] ? (
                <img crossOrigin="anonymous" src={(orderSource.images || [])[idx].src} alt={`photo-${idx}`} style={{ position: 'absolute', left: 0, top: 0, transformOrigin: 'center', width: '100%', height: '100%', objectFit: 'cover', transform: `translate(${crop.x * ratio}px, ${crop.y * ratio}px) scale(${crop.scale}) rotate(${crop.rotation}deg)`, transition: 'transform 0.1s' }} />
              ) : <div style={{ width: '100%', height: '100%', background: '#f1f5f9' }} />}
              <div style={{ position: 'absolute', bottom: '1px', left: '1px', background: 'rgba(255,255,255,0.8)', color: color, fontSize: '5px', fontWeight: 700, padding: '1px 3px', borderRadius: '1px' }}>Photo {idx + 1}</div>
            </div>
          ) : (
             <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 600 }}>EMPTY</span>
             </div>
          )}
        </div>
      );
    };

    return (
      <div style={{
        width: '330.2px',
        height: '482.6px',
        background: '#ffffff',
        position: 'relative',
        boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
        transformOrigin: 'top center',
        transform: 'scale(0.85)',
        marginBottom: '-50px'
      }}>
        {/* Green Cut Line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '1px solid #22c55e', pointerEvents: 'none', zIndex: 5 }} />
        {/* Red Safe Margin */}
        <div style={{ position: 'absolute', top: '11.25px', left: '5px', right: '5px', bottom: '11.25px', border: '1px solid #ef4444', pointerEvents: 'none', zIndex: 5 }} />
        
        {/* Barcode Placeholders */}
        <div style={{ position: 'absolute', left: '14px', top: '106px', fontSize: '6px', fontWeight: 800, color: '#1e3a8a' }}>Bt 000001</div>
        <div style={{ position: 'absolute', left: '160px', top: '106px', fontSize: '6px', fontWeight: 800, color: '#1e3a8a' }}>Bt 000001</div>
        <div style={{ position: 'absolute', left: '251px', top: '140px', fontSize: '6px', fontWeight: 800, color: '#1e3a8a' }}>Bt 000001</div>

        <div style={{ position: 'absolute', left: '160px', top: '22px', fontSize: '8px', fontWeight: 800, color: '#000', whiteSpace: 'nowrap' }}>Butterfly Box Print Template</div>

        {/* P1 Large */}
        {p1_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}
        {/* P2 Large */}
        {p2_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}
        {/* P1 Small */}
        {p1_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}
        {/* P2 Small */}
        {p2_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}
      </div>
    );
  };
  const changeActiveButterflyPhoto = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= 8) return;
    setButterflyCrops(prev => ({
      ...prev,
      [activeButterflyIndex]: { scale: photoScale, rotation: photoRotation, x: photoOffsetX, y: photoOffsetY }
    }));
    const saved = butterflyCrops[newIdx] || { scale: 1, rotation: 0, x: 0, y: 0 };
    setPhotoScale(saved.scale);
    setPhotoRotation(saved.rotation);
    setPhotoOffsetX(saved.x);
    setPhotoOffsetY(saved.y);
    setActiveButterflyIndex(newIdx);
    if (order.images && order.images[newIdx]) {
      setLivePreviewPhoto(order.images[newIdx].src || order.images[newIdx].url);
    }
  };

  useEffect(() => {
    if (isButterfly) {
      setButterflyCrops(prev => ({
        ...prev,
        [activeButterflyIndex]: { scale: photoScale, rotation: photoRotation, x: photoOffsetX, y: photoOffsetY }
      }));
    }
  }, [photoScale, photoRotation, photoOffsetX, photoOffsetY, activeButterflyIndex, isButterfly]);

  const [canvasElements, setCanvasElements] = useState<CanvasElement[]>(() => {
    // Load existing design data if present
    if (order.designData) {
      try {
        const parsed = JSON.parse(order.designData);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    // Start with customer uploaded images if available
    if (order.images && order.images.length > 0) {
      return order.images.map((img: any, i: number) => ({
        id: `img-main-${i}`,
        type: 'image',
        src: img.src || img.url,
        x: 50 + (img.position?.x ?? 0) + (i * 20),
        y: 50 + (img.position?.y ?? 0) + (i * 20),
        width: 300 * (img.zoom ?? 1),
        height: 300 * (img.zoom ?? 1),
        rotation: img.rotation || 0,
        zIndex: i + 1,
        brightness: img.brightness ?? 100,
        contrast: img.contrast ?? 100,
        saturation: 100,
        blur: 0,
        grayscale: false,
        sepia: 0,
        flipX: false,
        flipY: false,
      }));
    }
    // Fallback to order.uploadedImageUrl
    if (order.uploadedImageUrl) {
      return [{
        id: 'img-main',
        type: 'image',
        src: order.uploadedImageUrl,
        x: 50,
        y: 50,
        width: 400,
        height: 400,
        rotation: 0,
        zIndex: 1,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        blur: 0,
        grayscale: false,
        sepia: 0,
        flipX: false,
        flipY: false,
      }];
    }
    return [];
  });

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'layers' | 'text' | 'image' | 'stickers' | 'shapes' | 'overlays'>('image');
  const [canvasScale, setCanvasScale] = useState(1.0);
  const [snapAlign, setSnapAlign] = useState(true);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; startY: number; origW: number; origH: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Canvas size based on product type
  const canvasSize = (() => {
    const pt = (order.productType || order.product || '').toLowerCase();
    if (pt.includes('mug')) return { w: 660, h: 330 };
    if (pt.includes('phone') || pt.includes('case')) return { w: 400, h: 700 };
    if (pt.includes('poster')) return { w: 594, h: 841 };
    return { w: 500, h: 500 }; // frame / default square
  })();

  const selectedElement = canvasElements.find(e => e.id === selectedElementId) || null;

  const updateElementProps = useCallback((id: string, props: Partial<CanvasElement>) => {
    setCanvasElements(prev => prev.map(el => el.id === id ? { ...el, ...props } : el));
  }, []);

  const addText = () => {
    const newEl: CanvasElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      text: 'Your Text Here',
      x: 50,
      y: 50,
      width: 200,
      height: 50,
      rotation: 0,
      zIndex: canvasElements.length + 1,
      fontSize: 24,
      fontFamily: 'Inter, sans-serif',
      color: '#1a1a2e',
      bold: false,
      italic: false,
      underline: false,
      textAlign: 'left',
    };
    setCanvasElements(prev => [...prev, newEl]);
    setSelectedElementId(newEl.id);
    setActiveTab('text');
  };

  const addShape = (shapeType: 'circle' | 'rect' | 'triangle' | 'star') => {
    const newEl: CanvasElement = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      shapeType,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      zIndex: canvasElements.length + 1,
      fillColor: '#4f46e5',
      strokeColor: '#ffffff',
      strokeWidth: 2,
    };
    setCanvasElements(prev => [...prev, newEl]);
    setSelectedElementId(newEl.id);
  };

  const addSticker = (emoji: string) => {
    const newEl: CanvasElement = {
      id: `sticker-${Date.now()}`,
      type: 'sticker',
      src: emoji,
      x: 80,
      y: 80,
      width: 60,
      height: 60,
      rotation: 0,
      zIndex: canvasElements.length + 1,
    };
    setCanvasElements(prev => [...prev, newEl]);
    setSelectedElementId(newEl.id);
  };

  const deleteSelected = () => {
    if (!selectedElementId) return;
    setCanvasElements(prev => prev.filter(e => e.id !== selectedElementId));
    setSelectedElementId(null);
  };

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElementId(id);
    const el = canvasElements.find(x => x.id === id);
    if (!el) return;
    setDragging({ id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingPhoto) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setPhotoOffsetX(photoOffsetStart.current.x + dx);
      setPhotoOffsetY(photoOffsetStart.current.y + dy);
      return;
    }
    if (dragging) {
      const dx = (e.clientX - dragging.startX) / canvasScale;
      const dy = (e.clientY - dragging.startY) / canvasScale;
      updateElementProps(dragging.id, { x: dragging.origX + dx, y: dragging.origY + dy });
    }
    if (resizing) {
      const dx = (e.clientX - resizing.startX) / canvasScale;
      const dy = (e.clientY - resizing.startY) / canvasScale;
      updateElementProps(resizing.id, {
        width: Math.max(40, resizing.origW + dx),
        height: Math.max(40, resizing.origH + dy),
      });
    }
  }, [dragging, resizing, canvasScale, updateElementProps, isDraggingPhoto]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    setIsDraggingPhoto(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const renderElement = (el: CanvasElement) => {
    const isSelected = el.id === selectedElementId;
    return (
      <div
        key={el.id}
        onMouseDown={(e) => handleMouseDown(e, el.id)}
        style={{
          position: 'absolute',
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
          transform: `rotate(${el.rotation}deg)`,
          zIndex: el.zIndex,
          cursor: 'move',
          boxSizing: 'border-box',
          outline: isSelected ? '2px solid #4f46e5' : 'none',
          userSelect: 'none',
        }}
      >
        {el.type === 'image' && (
          <img
            src={el.src}
            alt="design element"
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: `brightness(${el.brightness ?? 100}%) contrast(${el.contrast ?? 100}%) saturate(${el.saturation ?? 100}%) blur(${el.blur ?? 0}px) grayscale(${el.grayscale ? 1 : 0}) sepia(${(el.sepia ?? 0) / 10})`,
              transform: `scaleX(${el.flipX ? -1 : 1}) scaleY(${el.flipY ? -1 : 1})`,
            }}
          />
        )}
        {el.type === 'text' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              fontSize: el.fontSize,
              fontFamily: el.fontFamily,
              color: el.color,
              fontWeight: el.bold ? 700 : 400,
              fontStyle: el.italic ? 'italic' : 'normal',
              textDecoration: el.underline ? 'underline' : 'none',
              textAlign: el.textAlign as any,
              display: 'flex',
              alignItems: 'center',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            {el.text}
          </div>
        )}
        {el.type === 'shape' && (
          el.shapeType === 'circle' ? (
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: el.fillColor, border: `${el.strokeWidth ?? 2}px solid ${el.strokeColor || '#fff'}` }} />
          ) : el.shapeType === 'rect' ? (
            <div style={{ width: '100%', height: '100%', background: el.fillColor, border: `${el.strokeWidth ?? 2}px solid ${el.strokeColor || '#fff'}` }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: el.fillColor, clipPath: el.shapeType === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' }} />
          )
        )}
        {el.type === 'sticker' && (
          <span style={{ fontSize: Math.min(el.width, el.height) * 0.8, display: 'block', textAlign: 'center', lineHeight: `${el.height}px` }}>
            {el.src}
          </span>
        )}
        {/* Resize handle */}
        {isSelected && (
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              setResizing({ id: el.id, startX: e.clientX, startY: e.clientY, origW: el.width, origH: el.height });
            }}
            style={{
              position: 'absolute', bottom: -6, right: -6,
              width: 12, height: 12, background: '#4f46e5',
              borderRadius: '50%', cursor: 'se-resize', zIndex: 999,
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top Bar ── */}
      <div className="flex align-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <div className="flex align-center gap-3">
          <button className="btn btn-outline btn-sm" onClick={onClose}>
            <i className="bi bi-arrow-left" style={{ marginRight: 6 }} /> Back
          </button>
          <div>
            <h2 className="font-bold text-sm" style={{ color: 'var(--primary)', margin: 0 }}>
              Design Review — Order: <span style={{ color: 'var(--accent)' }}>{order.id}</span>
            </h2>
            <p className="text-xs text-muted" style={{ margin: 0 }}>
              {order.customerName || 'Customer'} · {order.product || order.productType || 'Product'}
            </p>
          </div>
        </div>
        <div className="flex align-center gap-2">
          <span className={`badge ${order.customizationStatus === 'approved' ? 'badge-success' : order.customizationStatus === 'rejected' ? 'badge-error' : 'badge-warning'}`}>
            {order.customizationStatus || 'pending'}
          </span>
        </div>
      </div>

      {/* ── Main Editor Area ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', flex: 1, overflow: 'hidden' }}>

        {/* Left: Tools Panel */}
        <div style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)', padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 className="font-bold text-xs" style={{ color: 'var(--primary)', textTransform: 'uppercase', margin: 0 }}>Editor Tools</h3>

          {/* Tab switcher */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(['layers', 'text', 'image', 'stickers', 'shapes', 'overlays'] as const).map(tab => (
              <button
                key={tab}
                className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-outline'}`}
                style={{ fontSize: 10, padding: '4px 8px', textTransform: 'capitalize' }}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* TAB: LAYERS */}
          {activeTab === 'layers' && (
            <div className="flex flex-col gap-2">
              <div className="text-xxs text-muted font-bold">Layer Order</div>
              {canvasElements.length === 0 ? (
                <div className="text-xs text-muted" style={{ fontStyle: 'italic' }}>No layers yet</div>
              ) : [...canvasElements].sort((a, b) => b.zIndex - a.zIndex).map(el => (
                <div
                  key={el.id}
                  className="flex align-center justify-between p-2"
                  style={{ background: selectedElementId === el.id ? 'var(--primary-soft)' : 'rgba(0,0,0,0.03)', borderRadius: 6, cursor: 'pointer', border: `1px solid ${selectedElementId === el.id ? 'var(--primary)' : 'var(--border-color)'}` }}
                  onClick={() => setSelectedElementId(el.id)}
                >
                  <span className="text-xs capitalize" style={{ fontWeight: selectedElementId === el.id ? 700 : 400 }}>
                    {el.type}: {el.text?.slice(0, 10) || el.shapeType || el.src?.slice(0, 12) || 'media'}
                  </span>
                  <div className="flex gap-1">
                    <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); updateElementProps(el.id, { zIndex: el.zIndex + 1 }); }}>
                      <i className="bi bi-chevron-up" style={{ fontSize: 11 }} />
                    </button>
                    <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); updateElementProps(el.id, { zIndex: Math.max(1, el.zIndex - 1) }); }}>
                      <i className="bi bi-chevron-down" style={{ fontSize: 11 }} />
                    </button>
                    <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--error)' }} onClick={(e) => { e.stopPropagation(); setCanvasElements(prev => prev.filter(x => x.id !== el.id)); if (selectedElementId === el.id) setSelectedElementId(null); }}>
                      <i className="bi bi-trash" style={{ fontSize: 11 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: TEXT */}
          {activeTab === 'text' && (
            <div className="flex flex-col gap-3">
              <button className="btn btn-primary btn-sm" onClick={addText}>
                <i className="bi bi-type" style={{ marginRight: 6 }} /> Add Text
              </button>
              {selectedElement?.type === 'text' && (
                <div className="flex flex-col gap-2">
                  <textarea
                    className="input text-xs"
                    rows={3}
                    value={selectedElement.text || ''}
                    onChange={e => updateElementProps(selectedElement.id, { text: e.target.value })}
                    placeholder="Text content..."
                  />
                  <div>
                    <label className="text-xxs text-muted">Font Size: {selectedElement.fontSize}px</label>
                    <input type="range" min={10} max={120} value={selectedElement.fontSize ?? 24}
                      onChange={e => updateElementProps(selectedElement.id, { fontSize: +e.target.value })}
                      style={{ width: '100%' }} />
                  </div>
                  <input type="color" value={selectedElement.color || '#000000'}
                    onChange={e => updateElementProps(selectedElement.id, { color: e.target.value })}
                    style={{ width: '100%', height: 32, borderRadius: 6, cursor: 'pointer' }} />
                  <div className="flex gap-2">
                    <button className={`btn btn-sm ${selectedElement.bold ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateElementProps(selectedElement.id, { bold: !selectedElement.bold })}>B</button>
                    <button className={`btn btn-sm ${selectedElement.italic ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateElementProps(selectedElement.id, { italic: !selectedElement.italic })}>I</button>
                    <button className={`btn btn-sm ${selectedElement.underline ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateElementProps(selectedElement.id, { underline: !selectedElement.underline })}>U</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: IMAGE */}
          {activeTab === 'image' && (
            <div className="flex flex-col gap-3">
              {order.uploadedImageUrl ? (
                <div>
                  <div className="text-xxs text-muted font-bold mb-2">Customer Uploaded Image</div>
                  <img src={order.uploadedImageUrl} alt="Uploaded" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border-color)' }} />
                  <button className="btn btn-outline btn-sm mt-2" style={{ width: '100%' }}
                    onClick={() => {
                      const newEl: CanvasElement = {
                        id: `img-${Date.now()}`, type: 'image', src: order.uploadedImageUrl,
                        x: 50, y: 50, width: 300, height: 300, rotation: 0, zIndex: canvasElements.length + 1,
                        brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: false, sepia: 0, flipX: false, flipY: false,
                      };
                      setCanvasElements(prev => [...prev, newEl]);
                      setSelectedElementId(newEl.id);
                    }}>
                    <i className="bi bi-plus-circle" style={{ marginRight: 6 }} /> Add to Canvas
                  </button>
                </div>
              ) : (
                <div className="text-xs text-muted" style={{ fontStyle: 'italic' }}>No image uploaded yet</div>
              )}
              {selectedElement?.type === 'image' && (
                <div className="flex flex-col gap-2">
                  <div className="text-xxs font-bold text-muted">Adjustments</div>
                  {[
                    { label: 'Brightness', key: 'brightness', min: 0, max: 200, def: 100 },
                    { label: 'Contrast', key: 'contrast', min: 0, max: 200, def: 100 },
                    { label: 'Saturation', key: 'saturation', min: 0, max: 200, def: 100 },
                    { label: 'Blur', key: 'blur', min: 0, max: 20, def: 0 },
                    { label: 'Sepia', key: 'sepia', min: 0, max: 100, def: 0 },
                  ].map(({ label, key, min, max, def }) => (
                    <div key={key}>
                      <label className="text-xxs text-muted">{label}: {(selectedElement as any)[key] ?? def}</label>
                      <input type="range" min={min} max={max} value={(selectedElement as any)[key] ?? def}
                        onChange={e => updateElementProps(selectedElement.id, { [key]: +e.target.value })}
                        style={{ width: '100%' }} />
                    </div>
                  ))}
                  <label className="text-xs flex align-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!selectedElement.grayscale}
                      onChange={e => updateElementProps(selectedElement.id, { grayscale: e.target.checked })} />
                    Grayscale
                  </label>
                  <div className="flex gap-2">
                    <button className="btn btn-outline btn-sm" onClick={() => updateElementProps(selectedElement.id, { flipX: !selectedElement.flipX })}>
                      <i className="bi bi-symmetry-horizontal" /> Flip X
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => updateElementProps(selectedElement.id, { flipY: !selectedElement.flipY })}>
                      <i className="bi bi-symmetry-vertical" /> Flip Y
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: STICKERS */}
          {activeTab === 'stickers' && (
            <div className="flex flex-col gap-2">
              <div className="text-xxs text-muted font-bold">Click to Add</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {STICKER_EMOJIS.map(emoji => (
                  <button key={emoji} onClick={() => addSticker(emoji)}
                    style={{ fontSize: 22, background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, cursor: 'pointer', padding: 4, lineHeight: 1 }}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB: SHAPES */}
          {activeTab === 'shapes' && (
            <div className="flex flex-col gap-2">
              <div className="text-xxs text-muted font-bold">Add Shape</div>
              {(['circle', 'rect', 'triangle', 'star'] as const).map(shape => (
                <button key={shape} className="btn btn-outline btn-sm" onClick={() => addShape(shape)} style={{ textTransform: 'capitalize' }}>
                  <i className={`bi bi-${shape === 'circle' ? 'circle' : shape === 'rect' ? 'square' : shape === 'triangle' ? 'triangle' : 'star'}`} style={{ marginRight: 6 }} />
                  {shape}
                </button>
              ))}
              {selectedElement?.type === 'shape' && (
                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xxs text-muted">Fill Color</label>
                  <input type="color" value={selectedElement.fillColor || '#4f46e5'}
                    onChange={e => updateElementProps(selectedElement.id, { fillColor: e.target.value })}
                    style={{ width: '100%', height: 30, borderRadius: 6 }} />
                  <label className="text-xxs text-muted">Stroke Color</label>
                  <input type="color" value={selectedElement.strokeColor || '#ffffff'}
                    onChange={e => updateElementProps(selectedElement.id, { strokeColor: e.target.value })}
                    style={{ width: '100%', height: 30, borderRadius: 6 }} />
                </div>
              )}
            </div>
          )}

          {/* TAB: OVERLAYS */}
          {activeTab === 'overlays' && (
            <div className="flex flex-col gap-2">
              <div className="text-xxs text-muted font-bold">Canvas Overlay</div>
              {OVERLAYS.map(ov => (
                <label key={ov.id} className="text-xs flex align-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={activeOverlay === ov.id}
                    onChange={e => setActiveOverlay(e.target.checked ? ov.id : null)} />
                  {ov.name}
                </label>
              ))}
            </div>
          )}

          {/* Delete selected */}
          {selectedElementId && (
            <button className="btn btn-sm" style={{ marginTop: 'auto', background: 'var(--error)', color: '#fff', border: 'none' }} onClick={deleteSelected}>
              <i className="bi bi-trash" style={{ marginRight: 6 }} /> Delete Selected
            </button>
          )}
        </div>

        {/* Center: Canvas */}
        <div style={{ background: 'var(--bg-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', overflow: 'auto', position: 'relative' }}>
          {isButterfly ? (
            /* Butterfly Box Sheet Preview & Adjuster */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%', position: 'relative' }}>
              
              {/* Toggle Mode Switch */}
              <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.08)', padding: '4px', borderRadius: '99px', border: '1px solid rgba(255, 255, 255, 0.1)', gap: '4px', zIndex: 100 }}>
                <button 
                  type="button"
                  onClick={() => setButterflyPreviewMode('sheet')}
                  style={{ padding: '6px 16px', borderRadius: '99px', border: 'none', background: butterflyPreviewMode === 'sheet' ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <i className="bi bi-file-earmark-pdf" style={{ marginRight: '5px' }} /> Print Sheet View
                </button>
                <button 
                  type="button"
                  onClick={() => setButterflyPreviewMode('mockup')}
                  style={{ padding: '6px 16px', borderRadius: '99px', border: 'none', background: butterflyPreviewMode === 'mockup' ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <i className="bi bi-box-seam" style={{ marginRight: '5px' }} /> 3D Mockup Box
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '28px', width: '100%', padding: '0 20px', flexWrap: 'wrap' }}>
                
                {/* Left side: Preview Stage */}
                {butterflyPreviewMode === 'sheet' ? (
                  <div style={{ padding: '20px' }}>
                    {renderButterflySheet(false)}
                  </div>

                ) : (
                  /* 3D Isometric Exploding Box Mockup Preview */
                  <div style={{
                    width: '240px',
                    height: '310px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    perspective: '800px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    <style>{`
                      @keyframes floatButterfly {
                        0% { transform: translateZ(20px) translateY(0px) rotateZ(-45deg); }
                        50% { transform: translateZ(30px) translateY(-6px) rotateZ(-40deg); }
                        100% { transform: translateZ(20px) translateY(0px) rotateZ(-45deg); }
                      }
                      @keyframes spinBox {
                        0% { transform: rotateX(55deg) rotateZ(0deg); }
                        100% { transform: rotateX(55deg) rotateZ(360deg); }
                      }
                    `}</style>
                    <div style={{
                      position: 'relative',
                      width: '140px',
                      height: '140px',
                      transformStyle: 'preserve-3d',
                      transform: 'rotateX(55deg) rotateZ(45deg)',
                      animation: 'spinBox 18s linear infinite',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {/* Base center box plane */}
                      <div style={{
                        position: 'absolute',
                        width: '46px',
                        height: '46px',
                        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                        border: '1.5px solid #475569',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                        transform: 'translateZ(0px)'
                      }} />
                      
                      {/* Side Flaps 1 to 4 with custom crops */}
                      {[0, 1, 2, 3].map(idx => {
                        const transforms = [
                          'translateX(-45px) rotateY(-25deg)', // left
                          'translateX(45px) rotateY(25deg)',   // right
                          'translateY(-45px) rotateX(25deg)',  // top
                          'translateY(45px) rotateX(-25deg)'   // bottom
                        ];
                        const origin = [
                          'right center',
                          'left center',
                          'center bottom',
                          'center top'
                        ];
                        const shadows = [
                          '-3px 3px 8px rgba(0,0,0,0.3)',
                          '3px 3px 8px rgba(0,0,0,0.3)',
                          '0 -3px 8px rgba(0,0,0,0.3)',
                          '0 3px 8px rgba(0,0,0,0.3)'
                        ];
                        const crop = butterflyCrops[idx] || { scale: 1, rotation: 0, x: 0, y: 0 };
                        const ratio = 44 / 140;

                        return (
                          <div key={idx} style={{
                            position: 'absolute',
                            width: '44px',
                            height: '44px',
                            transform: transforms[idx],
                            transformOrigin: origin[idx],
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            boxShadow: shadows[idx],
                            overflow: 'hidden'
                          }}>
                            {order.images && order.images[idx] ? (
                              <img 
                                src={order.images[idx].src || order.images[idx].url} 
                                alt={`flap-${idx}`}
                                style={{ 
                                  width: '100%', 
                                  height: '100%', 
                                  objectFit: 'cover',
                                  transform: `translate(${crop.x * ratio}px, ${crop.y * ratio}px) scale(${crop.scale}) rotate(${crop.rotation}deg)`,
                                  transition: 'transform 0.15s ease-out'
                                }} 
                              />
                            ) : (
                              <div style={{ width: '100%', height: '100%', background: '#cbd5e1' }} />
                            )}
                          </div>
                        );
                      })}

                      {/* Floating Pop-up 3D Butterfly */}
                      <div style={{
                        position: 'absolute',
                        fontSize: '22px',
                        transform: 'translateZ(20px) rotateZ(-45deg)',
                        animation: 'floatButterfly 2.2s ease-in-out infinite',
                        textShadow: '0 8px 12px rgba(0,0,0,0.4)',
                        zIndex: 10
                      }}>
                        🦋
                      </div>
                    </div>
                  </div>
                )}

                {/* Right side: Active Cell Focus Editor */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(0, 0, 0, 0.04)',
                  borderRadius: '16px',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  padding: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.05)'
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Adjust Photo #{activeButterflyIndex + 1}
                  </div>
                  
                  <div style={{
                    position: 'relative',
                    width: '140px',
                    height: '140px',
                    borderRadius: '8px',
                    border: `2px dashed ${activeButterflyIndex < 4 ? '#3b82f6' : '#ef4444'}`,
                    overflow: 'hidden',
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)'
                  }}>
                    {order.images && order.images[activeButterflyIndex] ? (
                      <img
                        src={livePreviewPhoto || order.images[activeButterflyIndex]?.src || order.images[activeButterflyIndex]?.url}
                        alt="active-cell-preview"
                        style={{
                          transform: `translate(${photoOffsetX}px, ${photoOffsetY}px) scale(${photoScale}) rotate(${photoRotation}deg)`,
                          cursor: 'move',
                          transition: isDraggingPhoto ? 'none' : 'transform 0.15s ease-out',
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          userSelect: 'none',
                          touchAction: 'none'
                        }}
                        onMouseDown={e => { e.preventDefault(); setIsDraggingPhoto(true); dragStartPos.current = { x: e.clientX, y: e.clientY }; photoOffsetStart.current = { x: photoOffsetX, y: photoOffsetY }; }}
                      />
                    ) : (
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Select Photo</span>
                    )}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                    Drag inside the dashed box to position.
                  </div>
                </div>

              </div>

            </div>
          ) : (
            /* Standard Canvas */
            <>
              {/* Zoom controls */}
              <div className="flex align-center gap-2 p-2 card" style={{ position: 'absolute', top: 12, right: 12, zIndex: 100, flexDirection: 'row' }}>
                <label className="text-xxs text-muted">Zoom:</label>
                <input type="range" min={0.5} max={1.5} step={0.1} value={canvasScale}
                  onChange={e => setCanvasScale(+e.target.value)} style={{ width: 70 }} />
                <span className="text-xxs">{Math.round(canvasScale * 100)}%</span>
                <div style={{ width: 1, height: 14, background: 'var(--border-color)' }} />
                <label className="text-xxs flex align-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={snapAlign} onChange={e => setSnapAlign(e.target.checked)} />
                  Snap
                </label>
              </div>

              {/* Canvas surface */}
              <div
                ref={canvasRef}
                onClick={() => setSelectedElementId(null)}
                style={{
                  width: canvasSize.w,
                  height: canvasSize.h,
                  background: '#ffffff',
                  position: 'relative',
                  overflow: 'hidden',
                  transform: `scale(${canvasScale})`,
                  transformOrigin: 'center center',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                {/* Product frame guide */}
                <div style={{ position: 'absolute', inset: 0, border: '2px dashed rgba(79,70,229,0.3)', pointerEvents: 'none', zIndex: 9000, borderRadius: 4 }} />

                {/* Elements */}
                {[...canvasElements].sort((a, b) => a.zIndex - b.zIndex).map(renderElement)}

                {/* Overlay */}
                {activeOverlay === 'vignette' && (
                  <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)', pointerEvents: 'none', zIndex: 8000 }} />
                )}
                {activeOverlay === 'gold-border' && (
                  <div style={{ position: 'absolute', inset: 0, border: '12px solid', borderImage: 'linear-gradient(45deg, #b8860b, #ffd700, #b8860b) 1', pointerEvents: 'none', zIndex: 8000 }} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: Properties + Approval */}
        <div style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Butterfly active item properties */}
          {isButterfly && (
            <div className="flex flex-col gap-3">
              <h3 className="font-bold text-xs" style={{ color: 'var(--primary)', textTransform: 'uppercase', margin: 0 }}>
                Adjust Cell #{activeButterflyIndex + 1}
              </h3>
              <div>
                <label className="text-xxs text-muted">Scale: {Math.round(photoScale * 100)}%</label>
                <input type="range" min={0.5} max={3.0} step={0.05} value={photoScale}
                  onChange={e => setPhotoScale(parseFloat(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <label className="text-xxs text-muted">Rotation: {photoRotation}°</label>
                <input type="range" min={-180} max={180} value={photoRotation}
                  onChange={e => setPhotoRotation(parseInt(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-outline btn-xs" onClick={() => { setPhotoScale(1); setPhotoRotation(0); setPhotoOffsetX(0); setPhotoOffsetY(0); }}>Reset Values</button>
              </div>
            </div>
          )}

          {/* Selected element properties */}
          {!isButterfly && selectedElement && (
            <div className="flex flex-col gap-2">
              <h3 className="font-bold text-xs" style={{ color: 'var(--primary)', textTransform: 'uppercase', margin: 0 }}>
                Properties
              </h3>
              <div>
                <label className="text-xxs text-muted">X Position</label>
                <input type="number" className="input text-xs" value={Math.round(selectedElement.x)}
                  onChange={e => updateElementProps(selectedElement.id, { x: +e.target.value })} />
              </div>
              <div>
                <label className="text-xxs text-muted">Y Position</label>
                <input type="number" className="input text-xs" value={Math.round(selectedElement.y)}
                  onChange={e => updateElementProps(selectedElement.id, { y: +e.target.value })} />
              </div>
              <div>
                <label className="text-xxs text-muted">Width</label>
                <input type="number" className="input text-xs" value={Math.round(selectedElement.width)}
                  onChange={e => updateElementProps(selectedElement.id, { width: Math.max(10, +e.target.value) })} />
              </div>
              <div>
                <label className="text-xxs text-muted">Height</label>
                <input type="number" className="input text-xs" value={Math.round(selectedElement.height)}
                  onChange={e => updateElementProps(selectedElement.id, { height: Math.max(10, +e.target.value) })} />
              </div>
              <div>
                <label className="text-xxs text-muted">Rotation: {selectedElement.rotation}°</label>
                <input type="range" min={-180} max={180} value={selectedElement.rotation}
                  onChange={e => updateElementProps(selectedElement.id, { rotation: +e.target.value })}
                  style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* Order info */}
          <div className="card p-3" style={{ background: 'var(--bg-tertiary)' }}>
            <h3 className="font-bold text-xs" style={{ color: 'var(--primary)', textTransform: 'uppercase', marginBottom: 8 }}>Order Info</h3>
            <div className="text-xs text-muted flex flex-col gap-1">
              <span><b>ID:</b> {order.id}</span>
              <span><b>Customer:</b> {order.customerName || 'N/A'}</span>
              <span><b>Product:</b> {order.product || order.productType || 'N/A'}</span>
              <span><b>Status:</b> <span className="badge badge-warning" style={{ fontSize: 9 }}>{order.customizationStatus || 'pending'}</span></span>
            </div>
          </div>

          {/* Customer Live Preview */}
          {order.customerPreview && (
            <div className="card p-3" style={{ background: '#f8fafc', border: '1.5px solid var(--accent)' }}>
              <h3 className="font-bold text-xs flex align-center gap-2" style={{ color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 6 }}>
                <i className="bi bi-eye-fill" /> Customer Live Preview
              </h3>
              <p className="text-xxs text-muted mb-2" style={{ fontStyle: 'italic' }}>
                The original mockup layout submitted by the customer.
              </p>
              <img 
                src={order.customerPreview} 
                alt="Customer preview mockup" 
                style={{ width: '100%', borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--border-color)' }} 
                onClick={() => window.open(order.customerPreview, '_blank')} 
              />
            </div>
          )}

          {/* Admin Comments */}
          <div>
            <label className="label text-xs font-semibold" style={{ marginBottom: 4, display: 'block' }}>Admin Notes / Correction Instructions</label>
            <textarea
              className="input text-xs"
              rows={4}
              style={{ width: '100%', resize: 'vertical' }}
              placeholder="Add correction instructions if requesting design revision..."
              value={commentsValue}
              onChange={e => onCommentsChange(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2" style={{ marginTop: 'auto' }}>
            <button className="btn btn-outline btn-sm" onClick={() => {
              if (isButterfly) {
                const finalConfig = {
                  photoScale,
                  photoRotation,
                  photoOffsetX,
                  photoOffsetY,
                  butterflyCrops: {
                    ...butterflyCrops,
                    [activeButterflyIndex]: { scale: photoScale, rotation: photoRotation, x: photoOffsetX, y: photoOffsetY }
                  }
                };
                onSaveProgress(finalConfig as any);
              } else {
                onSaveProgress(canvasElements);
              }
            }}>
              <i className="bi bi-save" style={{ marginRight: 6 }} /> Save Draft
            </button>
            <button className="btn btn-sm" style={{ background: 'var(--warning)', color: '#fff', border: 'none' }} onClick={onRequestReupload}>
              <i className="bi bi-cloud-upload" style={{ marginRight: 6 }} /> Request Re-upload
            </button>
            <button className="btn btn-sm" style={{ background: 'var(--error)', color: '#fff', border: 'none' }} onClick={onReject}>
              <i className="bi bi-x-circle" style={{ marginRight: 6 }} /> Reject
            </button>
            <button className="btn btn-primary btn-sm" onClick={async () => {
              if (isButterfly) {
                const finalConfig = {
                  photoScale,
                  photoRotation,
                  photoOffsetX,
                  photoOffsetY,
                  butterflyCrops: {
                    ...butterflyCrops,
                    [activeButterflyIndex]: { scale: photoScale, rotation: photoRotation, x: photoOffsetX, y: photoOffsetY }
                  }
                };
                await onSaveProgress(finalConfig as any);
              }
              onApprove();
            }}>
              <i className="bi bi-check-circle" style={{ marginRight: 6 }} /> Approve & Send to Print
            </button>
            <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDesignEditor;

