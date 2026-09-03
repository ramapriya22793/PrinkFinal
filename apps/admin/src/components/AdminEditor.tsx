import React, { useState, useRef, useEffect } from 'react';
import useImage from 'use-image';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text, Circle, Line, Star, Path } from 'react-konva';

import { 
  ArrowLeft, Download, Upload, ZoomIn, ZoomOut, Save, FileCheck, RefreshCw, 
  Trash2, Move, Crop, Image as ImageIcon, Layers, Type, Sliders, Wand2, 
  Scissors, Box, Focus, Copy, Sun, Contrast, Droplet, Check, Eye, EyeOff, 
  Square, Circle as CircleIcon, Heart, Star as StarIcon, Smile, Compass, 
  QrCode, Barcode, CheckCircle, AlertTriangle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import html2canvas from 'html2canvas';
import { ButterflySheet } from './ButterflySheet';
import { MagazineSheet } from './MagazineSheet';

const PRINT_AREAS: Record<string, { x: number; y: number; width: number; height: number; }> = {
  'MUG-WHT-11OZ': { x: 125, y: 150, width: 250, height: 250 },
  'TSH-WHT-L': { x: 150, y: 180, width: 200, height: 280 },
  'BAG-CAN-001': { x: 120, y: 160, width: 260, height: 280 },
  'CAS-IP14-PRO': { x: 140, y: 100, width: 220, height: 420 },
  'FRM-WDN-8X10': { x: 130, y: 110, width: 240, height: 380 },
  'FRM-BLK-11X14': { x: 120, y: 100, width: 260, height: 400 },
  'PRK-MUG-CLASSIC': { x: 125, y: 150, width: 250, height: 250 },
  'PRK-CANVAS-1216': { x: 100, y: 100, width: 300, height: 400 },
  'PRK-FRM-810': { x: 130, y: 110, width: 240, height: 380 },
};

interface AdminEditorProps {
  order: any;
  onBack: () => void;
}

const EditorImage = ({ 
  src, 
  isSelected, 
  onSelect, 
  onChange, 
  filterType, 
  brightness = 0, 
  contrast = 0, 
  saturation = 0,
  blur = 0,
  visible = true,
  ...props 
}: any) => {
  const [img] = useImage(src, 'anonymous');
  const shapeRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  // Apply Konva filters dynamically
  useEffect(() => {
    if (img && shapeRef.current) {
      const node = shapeRef.current;
      const filters = [];
      
      if (filterType === 'grayscale') {
        filters.push((window as any).Konva.Filters.Grayscale);
      } else if (filterType === 'sepia') {
        filters.push((window as any).Konva.Filters.Sepia);
      }
      
      if (brightness !== 0) {
        filters.push((window as any).Konva.Filters.Brighten);
        node.brightness(brightness);
      }
      
      if (contrast !== 0) {
        filters.push((window as any).Konva.Filters.Contrast);
        node.contrast(contrast);
      }

      if (saturation !== 0) {
        filters.push((window as any).Konva.Filters.HSL);
        node.saturation(saturation);
      }

      if (blur !== 0) {
        filters.push((window as any).Konva.Filters.Blur);
        node.blurRadius(blur);
      }
      
      node.filters(filters);
      node.cache();
      node.getLayer()?.batchDraw();
    }
  }, [img, filterType, brightness, contrast, saturation, blur]);

  return (
    <>
      <KonvaImage
        image={img}
        ref={shapeRef}
        visible={visible}
        draggable
        onClick={(e) => { e.cancelBubble = true; onSelect(); }}
        onTap={(e) => { e.cancelBubble = true; onSelect(); }}
        onDragEnd={(e) => {
          onChange({
            ...props,
            filterType,
            brightness,
            contrast,
            blur,
            visible,
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...props,
            filterType,
            brightness,
            contrast,
            blur,
            visible,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
        {...props}
      />
      {isSelected && visible && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

export default function AdminEditor({ order, onBack }: AdminEditorProps) {
  const { showToast } = useToast();
  const [scale, setScale] = useState(0.85);
  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'adjust' | 'uploads' | 'text' | 'shapes' | 'ai' | 'layers'>('info');
  const [showTools, setShowTools] = useState(false);
  const [isReviewed, setIsReviewed] = useState(false);
  const [editingCropIdx, setEditingCropIdx] = useState<number | null>(null);
  
  // Undo/Redo history
  const [history, setHistory] = useState<any[][]>([]);
  const [historyStep, setHistoryStep] = useState(-1);

  // AI & Validation simulated statuses
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [resolutionStatus, setResolutionStatus] = useState<'pending' | 'ok' | 'warning'>('pending');
  const [dpiDetails, setDpiDetails] = useState('DPI check: Unvalidated');

  // Order Details Modal states
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const stageRef = useRef<any>(null);
  
  const [currentOrder, setCurrentOrder] = useState(order);
  const [recentUploads, setRecentUploads] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const adminUploadInputRef = useRef<HTMLInputElement>(null);
  const [butterflyCrops, setButterflyCrops] = useState<Record<number, any>>({});
  const isButterfly = (o: any) => [o?.productType, o?.product, o?.sku].join(' ').toLowerCase().includes('butterfly');
  const isMagazine = (o: any) => [o?.productType, o?.product, o?.sku].join(' ').toLowerCase().includes('magazine');

  // Selected element helper
  const selectedItem = items.find(i => i.id === selectedId);

  // Push state to history for Undo/Redo
  const saveToHistory = (newItems: any[]) => {
    const nextHistory = history.slice(0, historyStep + 1);
    setHistory([...nextHistory, newItems]);
    setHistoryStep(nextHistory.length);
  };

  const updateItemsAndHistory = (newItems: any[]) => {
    setItems(newItems);
    saveToHistory(newItems);
  };

  const handleUndo = () => {
    if (historyStep > 0) {
      const nextStep = historyStep - 1;
      setHistoryStep(nextStep);
      setItems(history[nextStep]);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      const nextStep = historyStep + 1;
      setHistoryStep(nextStep);
      setItems(history[nextStep]);
    }
  };

  const fetchRecentUploads = async () => {
    try {
      const res = await fetch('/api/uploads', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setRecentUploads(Array.isArray(data) ? data : (data.uploads || []));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (activeTab === 'uploads') {
      fetchRecentUploads();
    }
  }, [activeTab]);

  const handleAdminFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, replaceMode = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        if (replaceMode && selectedId) {
          const updated = items.map(item => item.id === selectedId ? { ...item, src: data.url } : item);
          updateItemsAndHistory(updated);
        } else {
          const freshArea = printArea;
          const newItem = {
            id: `cust-img-${Date.now()}`,
            type: 'image',
            src: data.url,
            x: freshArea.x + 40,
            y: freshArea.y + 40,
            width: freshArea.width - 80,
            height: freshArea.height - 80,
            rotation: 0,
            brightness: 0,
            contrast: 0,
            saturation: 0,
            blur: 0,
            opacity: 1,
            visible: true
          };
          updateItemsAndHistory([...items, newItem]);
        }
        fetchRecentUploads();
      } else {
        alert('Upload failed');
      }
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteUpload = async (id: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      const res = await fetch(`/api/uploads/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        fetchRecentUploads();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const productDefaults: Record<string, string> = {
    mobilecase: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?q=80&w=800',
    tshirt: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800',
    mug: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=800',
    pillow: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?q=80&w=800',
    frame: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?q=80&w=800',
    keychain: 'https://images.unsplash.com/photo-1582139329536-e7284fece509?q=80&w=800',
    photobook: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?q=80&w=800',
    calendar: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?q=80&w=800'
  };

  const getPrintArea = (sku: string, pType: string) => {
    if ((sku || '').toUpperCase().includes('CASE') || (pType || '').toLowerCase() === 'mobilecase') {
      return { x: 140, y: 90, width: 220, height: 430 };
    }
    return PRINT_AREAS[sku] || { x: 100, y: 100, width: 300, height: 300 };
  };

  const printArea = getPrintArea(currentOrder.sku || '', currentOrder.productType || '');

  // Fetch freshest order details on mount to capture new customer uploads & basic edits
  const fetchFreshOrder = async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id || order._id || order.orderNumber || "")}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        const fetchedOrder = data.order || data;
        setCurrentOrder(fetchedOrder);
        
        // 1. Try to restore from saved admin designData draft first!
        let restored = false;
        if (fetchedOrder.designData) {
          try {
            const parsed = typeof fetchedOrder.designData === 'string' ? JSON.parse(fetchedOrder.designData) : fetchedOrder.designData;
            if (parsed.butterflyCrops) {
              setButterflyCrops(parsed.butterflyCrops);
              restored = true;
            } else if (Array.isArray(parsed) && parsed.length > 0) {
              setItems(parsed);
              setHistory([parsed]);
              setHistoryStep(0);
              if (parsed.length > 0) {
                setSelectedId(parsed[0].id);
              }
              restored = true;
            } else if (parsed.items && Array.isArray(parsed.items)) {
              setItems(parsed.items);
              setHistory([parsed.items]);
              setHistoryStep(0);
              restored = true;
            }
          } catch (e) {
            console.error('[AdminEditor] Failed to parse designData:', e);
          }
        }

        const uploadedImgs = fetchedOrder.images;
        if (!restored && uploadedImgs && uploadedImgs.length > 0) {
          const freshArea = getPrintArea(fetchedOrder.sku || '', fetchedOrder.productType || '');
          const isSingleImage = (fetchedOrder.skuDetails?.supportedImageCount === 1) || 
                                ['mobilecase', 'mug', 'tshirt', 'frame', 'canvas', 'pillow', 'keychain']
                                .includes((fetchedOrder.productType || '').toLowerCase());
          const targetImgs = isSingleImage ? [uploadedImgs[0]] : uploadedImgs;
          const newItems = targetImgs.map((img: any, i: number) => {
            // Convert basic customer slider parameters (50 to 150) to Konva slider bounds (-1 to 1)
            const normBrightness = img.brightness ? (img.brightness - 100) / 50 : 0;
            const normContrast = img.contrast ? (img.contrast - 100) / 50 : 0;
            
            return {
              id: img.id || `cust-img-${i}`,
              type: 'image',
              src: img.src || img.url,
              // Shift based on basic customer translate offset
              x: freshArea.x + 20 + (img.position?.x ?? 0) + (i * 20),
              y: freshArea.y + 20 + (img.position?.y ?? 0) + (i * 20),
              width: (freshArea.width - 40) * (img.zoom ?? 1),
              height: (freshArea.height - 40) * (img.zoom ?? 1),
              rotation: img.rotation || 0,
              brightness: normBrightness,
              contrast: normContrast,
              saturation: 0,
              blur: 0,
              opacity: 1,
              visible: true
            };
          });
          setItems(newItems);
          setHistory([newItems]);
          setHistoryStep(0);
          if (newItems.length > 0) {
            setSelectedId(newItems[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch fresh order details:', err);
    }
  };

  useEffect(() => {
    fetchFreshOrder();
  }, [order.id]);

  const handleZoomIn = () => setScale(s => Math.min(s + 0.05, 1.5));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.05, 0.45));

  const checkDeselect = (e: any) => {
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.attrs.id === 'bg';
    if (clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  const deleteSelected = () => {
    if (selectedId) {
      const updated = items.filter(i => i.id !== selectedId);
      updateItemsAndHistory(updated);
      setSelectedId(null);
    }
  };

  const duplicateSelected = () => {
    if (!selectedId) return;
    const item = items.find(i => i.id === selectedId);
    if (!item) return;
    const duplicated = {
      ...item,
      id: `${item.type}-${Date.now()}`,
      x: item.x + 20,
      y: item.y + 20,
      zIndex: items.length + 1
    };
    updateItemsAndHistory([...items, duplicated]);
  };

  const moveLayer = (direction: 'up' | 'down' | 'front' | 'back') => {
    if (!selectedId) return;
    const index = items.findIndex(i => i.id === selectedId);
    if (index < 0) return;
    const newItems = [...items];
    
    if (direction === 'up' && index < items.length - 1) {
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    } else if (direction === 'down' && index > 0) {
      [newItems[index], newItems[index - 1]] = [newItems[index - 1], newItems[index]];
    } else if (direction === 'front') {
      const element = newItems.splice(index, 1)[0];
      newItems.push(element);
    } else if (direction === 'back') {
      const element = newItems.splice(index, 1)[0];
      newItems.unshift(element);
    }
    updateItemsAndHistory(newItems);
  };

  // Add text element to canvas
  const addTextElement = (size: 'heading' | 'paragraph') => {
    const freshArea = printArea;
    const isHeading = size === 'heading';
    const newEl = {
      id: `text-${Date.now()}`,
      type: 'text',
      text: isHeading ? 'Heading Title' : 'Body text paragraph details.',
      x: freshArea.x + 40,
      y: freshArea.y + 100,
      fontSize: isHeading ? 32 : 16,
      fontFamily: 'Inter',
      fill: '#1a1a2e',
      fontStyle: isHeading ? 'bold' : 'normal',
      rotation: 0,
      width: 250,
      visible: true
    };
    updateItemsAndHistory([...items, newEl]);
    setSelectedId(newEl.id);
  };

  // Add shape elements
  const addShapeElement = (shapeType: 'rect' | 'circle' | 'triangle' | 'heart' | 'star') => {
    const freshArea = printArea;
    const baseProps = {
      id: `shape-${Date.now()}`,
      type: 'shape',
      shapeType,
      x: freshArea.x + freshArea.width / 2 - 50,
      y: freshArea.y + freshArea.height / 2 - 50,
      width: 100,
      height: 100,
      fill: '#4f46e5',
      stroke: '#ffffff',
      strokeWidth: 2,
      rotation: 0,
      visible: true
    };
    updateItemsAndHistory([...items, baseProps]);
    setSelectedId(baseProps.id);
  };

  // Add QR codes and mock elements
  const addSpecialElement = (type: 'qrcode' | 'barcode') => {
    const freshArea = printArea;
    const newEl = {
      id: `${type}-${Date.now()}`,
      type: 'image',
      src: type === 'qrcode' 
        ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(currentOrder.id || currentOrder._id || currentOrder.orderNumber || "")}`
        : `https://www.barcodesinc.com/generator/image.php?code=${encodeURIComponent(currentOrder.id || currentOrder._id || currentOrder.orderNumber || "")}&style=197&type=C128B&width=200&height=50&xres=1&font=3`,
      x: freshArea.x + freshArea.width / 2 - 75,
      y: freshArea.y + freshArea.height - 100,
      width: type === 'qrcode' ? 80 : 160,
      height: type === 'qrcode' ? 80 : 50,
      rotation: 0,
      visible: true
    };
    updateItemsAndHistory([...items, newEl]);
    setSelectedId(newEl.id);
  };

  // AI Feature Trigger Sim
  const runAiTool = (toolName: string) => {
    setIsAiLoading(true);
    setAiMessage(`AI Model running: ${toolName}...`);
    setTimeout(() => {
      setIsAiLoading(false);
      if (toolName === 'upscale') {
        setResolutionStatus('ok');
        setDpiDetails('DPI check: 300 DPI (AI Enhanced) - EXCELLENT');
      }
      alert(`AI execution complete: ${toolName} applied successfully!`);
    }, 1500);
  };

  // Save draft details (JSON auto-saved style)
  const saveDraft = async () => {
    try {
      const isProductTemplate = (isButterfly(currentOrder) || isMagazine(currentOrder));
      const payloadData = isProductTemplate ? { butterflyCrops } : items;

      const res = await fetch(`/api/orders/${encodeURIComponent(currentOrder.id || currentOrder._id || currentOrder.orderNumber || "")}/design`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify({
          designData: JSON.stringify(payloadData),
          customizationStatus: 'in-progress'
        })
      });
      if (res.ok) {
        alert('Design draft saved successfully.');
      } else {
        alert('Failed to save design draft.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const generatePDF = async () => {
    setIsGenerating(true);
    
    // Open a blank tab synchronously at the start to bypass browser popup blockers
    const newTab = window.open('about:blank', '_blank');

    try {
      setSelectedId(null);
      await new Promise(r => setTimeout(r, 100));

      const orderId = encodeURIComponent(
        currentOrder.id || currentOrder._id || currentOrder.orderNumber || ''
      );
      const isProductTemplate = isButterfly(currentOrder) || isMagazine(currentOrder);
      const payloadData = isProductTemplate ? { butterflyCrops } : items;

      // Send ONLY the design data as a small JSON body — no canvas image.
      // The server regenerates the PDF from the customer's original uploaded
      // photos stored in MongoDB, giving full original quality with no 413 risk.
      const response = await fetch(`/api/orders/${orderId}/submit-design`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
        body: JSON.stringify({ designData: payloadData }),
      });

      let data: any = {};
      try { data = await response.json(); }
      catch { throw new Error(`Server error ${response.status}: ${response.statusText}`); }

      if (data.success) {
        setShowSuccess(true);
        // Automatically read the generated PDF from the response/DB and open it in a new tab
        const printFile = (data.printFiles && data.printFiles[0]) || (data.order && data.order.printFiles && data.order.printFiles[0]);
        const pdfUrl = printFile ? printFile.url : (data.pdfUrl || (data.order && data.order.pdfUrl));
        if (pdfUrl && newTab) {
          newTab.location.href = pdfUrl;
        } else if (newTab) {
          newTab.close();
        }
        setTimeout(() => { onBack(); }, 2000);
      } else {
        if (newTab) newTab.close();
        alert('Failed to generate PDF: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      if (newTab) newTab.close();
      console.error(err);
      alert('Error generating PDF: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGenerating(false);
    }
  };





  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] font-sans">
      {/* Header */}
      <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-900 text-lg">Prink Professional Editor</h1>
            <p className="text-xs text-gray-500 font-medium">Order {currentOrder.id} • SKU: {currentOrder.sku} • {typeof currentOrder.customer === 'object' ? currentOrder.customer?.name : currentOrder.customer}</p>
          </div>
        </div>

        {/* Top toolbar tools (undo/redo, zoom) */}
        <div className="flex items-center gap-2">
          <button onClick={handleUndo} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="Undo"><RefreshCw size={18} className="transform -scale-x-100" /></button>
          <button onClick={handleRedo} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="Redo"><RefreshCw size={18} /></button>
          <div className="w-px h-6 bg-gray-200 mx-2" />
          <button onClick={handleZoomOut} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><ZoomOut size={18} /></button>
          <span className="text-sm font-medium text-gray-600 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><ZoomIn size={18} /></button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={async () => {
              await fetchFreshOrder();
              showToast('Synced layout with database uploads!', 'success');
            }} 
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
          >
            <RefreshCw size={18} /> Sync Database
          </button>
          <button onClick={saveDraft} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2">
            <Save size={18} /> Save Draft
          </button>
          {((isButterfly(currentOrder) || isMagazine(currentOrder))) && (
            <>
              {(!isReviewed && currentOrder.status !== 'completed' && currentOrder.status !== 'print-ready' && currentOrder.uploadStatus !== 'ready') && (
                <>
                  <button 
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/orders/${encodeURIComponent(currentOrder.id || currentOrder._id || currentOrder.orderNumber || "")}/review`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
                          body: JSON.stringify({ action: 'approve', comments: 'Approved from Editor' })
                        });
                        if(res.ok) { alert('Design Approved!'); setIsReviewed(true); }
                      } catch(e) { console.error(e); }
                    }}
                    className="px-4 py-2 bg-green-50 text-green-700 font-medium rounded-lg hover:bg-green-100 transition-colors flex items-center gap-2"
                  >
                    Approve
                  </button>
                  <button 
                    onClick={async () => {
                      const comments = prompt('Reason for rejection:');
                      if (comments === null) return;
                      try {
                        const res = await fetch(`/api/orders/${encodeURIComponent(currentOrder.id || currentOrder._id || currentOrder.orderNumber || "")}/review`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
                          body: JSON.stringify({ action: 'reject', comments })
                        });
                        if(res.ok) { alert('Design Rejected!'); setIsReviewed(true); }
                      } catch(e) { console.error(e); }
                    }}
                    className="px-4 py-2 bg-red-50 text-red-700 font-medium rounded-lg hover:bg-red-100 transition-colors flex items-center gap-2"
                  >
                    Reject
                  </button>
                </>
              )}
              <button 
                onClick={() => setShowTools(!showTools)}
                className={`px-4 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 ${showTools ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {showTools ? 'Hide Tools' : 'Edit Tools'}
              </button>
              <button 
                onClick={() => {
                  const printWindow = window.open('', '_blank');
                  if (printWindow) {
                    printWindow.document.write(`
                      <html>
                        <head>
                          <title>Print Layout - ${currentOrder.id}</title>
                          <style>
                            body { margin: 0; padding: 20px; background: #52525b; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
                          </style>
                        </head>
                        <body>
                          ${document.getElementById('butterfly-sheet-layout') ? document.getElementById('butterfly-sheet-layout')?.outerHTML : ''}
                          ${document.getElementById('magazine-sheet-layout') ? document.getElementById('magazine-sheet-layout')?.outerHTML : ''}
                        </body>
                      </html>
                    `);
                    printWindow.document.close();
                  }
                }}
                className="px-4 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2"
              >
                <Box size={18} /> View Canvas
              </button>
            </>
          )}
          <button 
            onClick={generatePDF}
            disabled={isGenerating}
            className="px-5 py-2 bg-[#171C62] text-white font-medium rounded-lg hover:bg-indigo-900 transition-colors shadow-md flex items-center gap-2"
          >
            {isGenerating ? <RefreshCw size={18} className="animate-spin" /> : <FileCheck size={18} />}
            {isGenerating ? 'Compiling PDF...' : 'Send to Printer'}
          </button>
        </div>
      </header>

      {/* Main workspace panels */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Left Toolbar tabs */}
        {(!(isButterfly(currentOrder) || isMagazine(currentOrder)) || showTools) && (
          <div className="w-80 bg-white border-r flex flex-col z-10 overflow-y-auto">
          <div className="flex border-b overflow-x-auto flex-wrap">
            {(['info', 'adjust', 'uploads', 'text', 'shapes', 'ai', 'layers'] as const).map(tab => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)} 
                className={`flex-1 py-3 text-xs font-bold border-b-2 capitalize min-w-[70px] ${activeTab === tab ? 'border-[#171C62] text-[#171C62]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-5 flex-1 overflow-y-auto">
            {/* TAB: ORDER & CUSTOMER INFO */}
            {activeTab === 'info' && (
              <div className="space-y-5 text-gray-700 text-sm">
                <div>
                  <h3 className="font-bold text-gray-900 border-b pb-1.5 text-xs uppercase tracking-wider text-[#171C62] mb-3">Order Details</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Order Name:</span><span className="font-semibold">{currentOrder.id}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Shopify ID:</span><span className="font-semibold">{currentOrder.shopifyId || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Customer ID:</span><span className="font-semibold">{currentOrder.customerId || 'CUST-' + (currentOrder.id || '').toString().replace('#','')}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Product:</span><span className="font-semibold text-right max-w-[150px] truncate">{currentOrder.product}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">SKU Code:</span><span className="font-semibold">{currentOrder.sku || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Quantity:</span><span className="font-semibold">{currentOrder.quantity || 1} units</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Order Date:</span><span className="font-semibold">{currentOrder.date}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Due Date:</span><span className="font-semibold">{currentOrder.dueDate || 'Jul 20, 2026'}</span></div>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-900 border-b pb-1.5 text-xs uppercase tracking-wider text-[#171C62] mb-3">Customer Contact</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Name:</span><span className="font-semibold">{typeof currentOrder.customer === 'object' ? currentOrder.customer?.name : currentOrder.customer}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Phone:</span><span className="font-semibold">{currentOrder.phone || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Email:</span><span className="font-semibold">{currentOrder.email || 'N/A'}</span></div>
                  </div>
                </div>

                {currentOrder.shippingAddress && (
                  <div>
                    <h3 className="font-bold text-gray-900 border-b pb-1.5 text-xs uppercase tracking-wider text-[#171C62] mb-3">Shipping Target</h3>
                    <div className="space-y-1 text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-sans">
                      <div className="font-semibold text-gray-800">{currentOrder.shippingAddress.address1}</div>
                      <div>{currentOrder.shippingAddress.city}, {currentOrder.shippingAddress.state}</div>
                      <div>{currentOrder.shippingAddress.country} - {currentOrder.shippingAddress.postalCode}</div>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="font-bold text-gray-900 border-b pb-1.5 text-xs uppercase tracking-wider text-[#171C62] mb-3">Product Specs</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Variant Fit:</span><span className="font-semibold">{currentOrder.variant || 'Standard'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Color Variant:</span><span className="font-semibold">{currentOrder.color || 'Standard (Full Color)'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Product Size:</span><span className="font-semibold">{currentOrder.size || 'Standard'}</span></div>
                    <div className="flex justify-between"><span className="font-medium text-gray-500">Frame Frame:</span><span className="font-semibold">{currentOrder.frameType || 'N/A'}</span></div>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-900 border-b pb-1.5 text-xs uppercase tracking-wider text-[#171C62] mb-3">Special Instructions</h3>
                  <div className="text-xs text-gray-600 italic bg-amber-50 border border-amber-200 p-2.5 rounded-lg">
                    {currentOrder.customerNotes || currentOrder.adminComments || 'No special print instructions provided for this layout.'}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: ADJUST SELECTED ITEM */}
            {activeTab === 'adjust' && (
              <div className="space-y-6">
                {!selectedId ? (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <Sliders size={32} className="mx-auto mb-2 opacity-50" />
                    Select an item on the canvas to inspect and edit its properties.
                  </div>
                ) : (
                  <>
                    {/* Transform details */}
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Transform</h3>
                      <div className="grid grid-cols-4 gap-2">
                        <button 
                          onClick={() => setItems(items.map(item => item.id === selectedId ? { ...item, rotation: (item.rotation || 0) - 90 } : item))}
                          className="p-2 border rounded hover:bg-gray-50 flex justify-center" 
                          title="Rotate Left"
                        >
                          <RefreshCw size={16} className="transform -scale-x-100" />
                        </button>
                        <button 
                          onClick={() => setItems(items.map(item => item.id === selectedId ? { ...item, rotation: (item.rotation || 0) + 90 } : item))}
                          className="p-2 border rounded hover:bg-gray-50 flex justify-center" 
                          title="Rotate Right"
                        >
                          <RefreshCw size={16} />
                        </button>
                        <button 
                          onClick={() => setItems(items.map(item => item.id === selectedId ? { ...item, scaleX: -(item.scaleX || 1) } : item))}
                          className="p-2 border rounded hover:bg-gray-50 flex justify-center" 
                          title="Flip Horizontal"
                        >
                          <Move size={16} className="transform rotate-90" />
                        </button>
                        <button 
                          onClick={() => setItems(items.map(item => item.id === selectedId ? { ...item, scaleY: -(item.scaleY || 1) } : item))}
                          className="p-2 border rounded hover:bg-gray-50 flex justify-center" 
                          title="Flip Vertical"
                        >
                          <Move size={16} className="transform rotate-180" />
                        </button>
                      </div>
                    </div>
                    {selectedItem?.type === 'image' && (
                      <div className="space-y-6">
                        {/* Section 1: Light & Color */}
                        <div className="space-y-3.5 border-b pb-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Light & Color</h4>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Brightness</span>
                              <span>{Math.round(((selectedItem.brightness || 0) + 0.5) * 100)}%</span>
                            </div>
                            <input 
                              type="range" min="-0.5" max="0.5" step="0.05"
                              value={selectedItem.brightness || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, brightness: parseFloat(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Contrast</span>
                              <span>{Math.round(((selectedItem.contrast || 0) + 0.5) * 100)}%</span>
                            </div>
                            <input 
                              type="range" min="-0.5" max="0.5" step="0.05"
                              value={selectedItem.contrast || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, contrast: parseFloat(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Saturation</span>
                              <span>{Math.round(((selectedItem.saturation || 0) + 1) * 100)}%</span>
                            </div>
                            <input 
                              type="range" min="-1" max="5" step="0.1"
                              value={selectedItem.saturation || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, saturation: parseFloat(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                        </div>

                        {/* Section 2: Border & Radius */}
                        <div className="space-y-3.5 border-b pb-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Border & Radius</h4>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Corner Radius</span>
                              <span>{selectedItem.cornerRadius || 0}px</span>
                            </div>
                            <input 
                              type="range" min="0" max="100" step="2"
                              value={selectedItem.cornerRadius || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, cornerRadius: parseInt(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Border Width</span>
                              <span>{selectedItem.strokeWidth || 0}px</span>
                            </div>
                            <input 
                              type="range" min="0" max="15" step="1"
                              value={selectedItem.strokeWidth || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, strokeWidth: parseInt(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          {selectedItem.strokeWidth > 0 && (
                            <div>
                              <label className="block text-xs font-semibold text-gray-500 mb-1">Border Color</label>
                              <input 
                                type="color" value={selectedItem.stroke || '#ffffff'}
                                onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, stroke: e.target.value } : i))}
                                className="w-full h-8 border rounded cursor-pointer"
                              />
                            </div>
                          )}
                        </div>

                        {/* Section 3: Blur & Opacity */}
                        <div className="space-y-3.5 border-b pb-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Effects & Styling</h4>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Opacity</span>
                              <span>{Math.round((selectedItem.opacity ?? 1) * 100)}%</span>
                            </div>
                            <input 
                              type="range" min="0" max="1" step="0.05"
                              value={selectedItem.opacity ?? 1}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, opacity: parseFloat(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Blur effect</span>
                              <span>{selectedItem.blur || 0}px</span>
                            </div>
                            <input 
                              type="range" min="0" max="25" step="1"
                              value={selectedItem.blur || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, blur: parseInt(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                        </div>

                        {/* Section 4: Drop Shadow */}
                        <div className="space-y-3.5 border-b pb-4">
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Drop Shadow</h4>
                          <div>
                            <div className="flex justify-between text-xs mb-1 font-semibold text-gray-600">
                              <span>Shadow Blur</span>
                              <span>{selectedItem.shadowBlur || 0}px</span>
                            </div>
                            <input 
                              type="range" min="0" max="40" step="1"
                              value={selectedItem.shadowBlur || 0}
                              onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, shadowBlur: parseInt(e.target.value) } : i))}
                              className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                            />
                          </div>
                          {selectedItem.shadowBlur > 0 && (
                            <div className="space-y-2">
                              <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Shadow Color</label>
                                <input 
                                  type="color" value={selectedItem.shadowColor || '#000000'}
                                  onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, shadowColor: e.target.value } : i))}
                                  className="w-full h-8 border rounded cursor-pointer"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <span className="text-xxs text-gray-400 font-bold block mb-1">Offset X</span>
                                  <input 
                                    type="range" min="-30" max="30" step="1"
                                    value={selectedItem.shadowOffsetX || 0}
                                    onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, shadowOffsetX: parseInt(e.target.value) } : i))}
                                    className="w-full h-1 bg-gray-200 rounded accent-[#171C62]" 
                                  />
                                </div>
                                <div>
                                  <span className="text-xxs text-gray-400 font-bold block mb-1">Offset Y</span>
                                  <input 
                                    type="range" min="-30" max="30" step="1"
                                    value={selectedItem.shadowOffsetY || 0}
                                    onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, shadowOffsetY: parseInt(e.target.value) } : i))}
                                    className="w-full h-1 bg-gray-200 rounded accent-[#171C62]" 
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Preset Filters</h4>
                          <div className="grid grid-cols-3 gap-2">
                            {(['normal', 'grayscale', 'sepia'] as const).map(filt => (
                              <button
                                key={filt}
                                onClick={() => setItems(items.map(i => i.id === selectedId ? { ...i, filterType: filt } : i))}
                                className={`py-1.5 rounded text-xs border uppercase tracking-wider ${selectedItem.filterType === filt || (filt === 'normal' && !selectedItem.filterType) ? 'border-[#171C62] bg-indigo-50 font-bold' : 'bg-gray-50 border-gray-100 hover:bg-gray-100'}`}
                              >
                                {filt}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Text specific sliders */}
                    {selectedItem?.type === 'text' && (
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Text Properties</h3>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Text String</label>
                          <input 
                            type="text" value={selectedItem.text}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, text: e.target.value } : i))}
                            className="w-full border rounded p-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Font Family</label>
                          <select 
                            value={selectedItem.fontFamily}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, fontFamily: e.target.value } : i))}
                            className="w-full border rounded p-2 text-sm bg-white"
                          >
                            <option value="Inter">Inter (Sans)</option>
                            <option value="Roboto">Roboto</option>
                            <option value="Playfair Display">Playfair (Serif)</option>
                            <option value="Courier New">Courier</option>
                            <option value="Georgia">Georgia</option>
                          </select>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span>Font Size</span>
                            <span>{selectedItem.fontSize}px</span>
                          </div>
                          <input 
                            type="range" min="10" max="100"
                            value={selectedItem.fontSize}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, fontSize: parseInt(e.target.value) } : i))}
                            className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Fill Color</label>
                          <input 
                            type="color" value={selectedItem.fill || '#000000'}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, fill: e.target.value } : i))}
                            className="w-full h-10 border rounded cursor-pointer"
                          />
                        </div>
                      </div>
                    )}

                    {/* Shape specific sliders */}
                    {selectedItem?.type === 'shape' && (
                      <div className="space-y-4">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Shape Properties</h3>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Fill Color</label>
                          <input 
                            type="color" value={selectedItem.fill || '#4f46e5'}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, fill: e.target.value } : i))}
                            className="w-full h-10 border rounded cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Stroke Color</label>
                          <input 
                            type="color" value={selectedItem.stroke || '#ffffff'}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, stroke: e.target.value } : i))}
                            className="w-full h-10 border rounded cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span>Stroke Width</span>
                            <span>{selectedItem.strokeWidth || 0}px</span>
                          </div>
                          <input 
                            type="range" min="0" max="10"
                            value={selectedItem.strokeWidth || 0}
                            onChange={(e) => setItems(items.map(i => i.id === selectedId ? { ...i, strokeWidth: parseInt(e.target.value) } : i))}
                            className="w-full h-1 bg-gray-200 rounded-lg accent-[#171C62]" 
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB: PHOTO UPLOADS */}
            {activeTab === 'uploads' && (
              <div className="space-y-4">
                <input 
                  type="file" ref={adminUploadInputRef} style={{ display: 'none' }} 
                  onChange={(e) => handleAdminFileUpload(e, false)} 
                />
                <div 
                  onClick={() => adminUploadInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center hover:border-[#171C62] cursor-pointer bg-gray-50 transition-colors"
                >
                  <Upload size={28} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-sm font-semibold text-gray-700">Add New Image File</p>
                  <p className="text-xxs text-gray-400 mt-1">Saves to server uploads directory</p>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Customer Uploads</h3>
                  <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1 mb-4">
                    {(currentOrder.images || []).map((img: any) => (
                      <div key={img.id} className="group relative border border-gray-200 rounded-lg overflow-hidden bg-blue-50 flex items-center justify-center">
                        <img 
                          src={img.src || img.url} alt={img.name} 
                          onClick={() => {
                            const freshArea = printArea;
                            const newItem = {
                              id: `cust-img-${Date.now()}`,
                              type: 'image',
                              src: img.src || img.url,
                              x: freshArea.x + 40,
                              y: freshArea.y + 40,
                              width: freshArea.width - 80,
                              height: freshArea.height - 80,
                              rotation: 0,
                              brightness: 0,
                              contrast: 100
                            };
                            updateItemsAndHistory([...items, newItem]);
                          }}
                          className="w-full h-24 object-cover cursor-pointer group-hover:opacity-75 transition-opacity" 
                        />
                        <div className="absolute bottom-0 w-full bg-black/60 text-white text-[10px] truncate px-1 py-0.5 text-center pointer-events-none">
                          {img.name}
                        </div>
                      </div>
                    ))}
                    {(!currentOrder.images || currentOrder.images.length === 0) && (
                      <div className="col-span-2 text-center text-xs text-gray-400 py-4">No customer photos uploaded.</div>
                    )}
                  </div>

                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Asset Manager</h3>
                  {isUploading && (
                    <div className="text-center text-xs py-2 text-gray-400">Uploading...</div>
                  )}
                  <div className="grid grid-cols-2 gap-2 max-h-[350px] overflow-y-auto pr-1">
                    {(Array.isArray(recentUploads) ? recentUploads : []).map((img: any) => (
                      <div key={img.id} className="group relative border border-gray-100 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
                        <img 
                          src={img.src || img.url} alt={img.originalName} 
                          onClick={() => {
                            const freshArea = printArea;
                            const newItem = {
                              id: `cust-img-${Date.now()}`,
                              type: 'image',
                              src: img.src || img.url,
                              x: freshArea.x + 40,
                              y: freshArea.y + 40,
                              width: freshArea.width - 80,
                              height: freshArea.height - 80,
                              rotation: 0,
                              brightness: 0,
                              contrast: 0,
                              saturation: 0,
                              blur: 0,
                              opacity: 1,
                              visible: true
                            };
                            updateItemsAndHistory([...items, newItem]);
                          }}
                          className="w-full aspect-square object-cover cursor-pointer"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          <button onClick={() => handleDeleteUpload(img.id)} className="p-1.5 bg-red-600 text-white rounded hover:bg-red-700">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: TEXT ELEMENT */}
            {activeTab === 'text' && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Insert Text</h3>
                <button 
                  onClick={() => addTextElement('heading')}
                  className="w-full py-3 border border-gray-200 hover:border-[#171C62] hover:text-[#171C62] rounded-xl text-left px-4 font-bold text-md bg-white transition-all"
                >
                  Add Heading Text
                </button>
                <button 
                  onClick={() => addTextElement('paragraph')}
                  className="w-full py-3 border border-gray-200 hover:border-[#171C62] hover:text-[#171C62] rounded-xl text-left px-4 text-sm bg-white transition-all"
                >
                  Add Paragraph details
                </button>
              </div>
            )}

            {/* TAB: SHAPE ELEMENT */}
            {activeTab === 'shapes' && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Shapes & Graphics</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => addShapeElement('rect')} className="p-3 border rounded-xl bg-white hover:border-[#171C62] hover:text-[#171C62] flex flex-col items-center gap-1.5">
                    <Square size={20} /> Rectangle
                  </button>
                  <button onClick={() => addShapeElement('circle')} className="p-3 border rounded-xl bg-white hover:border-[#171C62] hover:text-[#171C62] flex flex-col items-center gap-1.5">
                    <CircleIcon size={20} /> Circle
                  </button>
                  <button onClick={() => addSpecialElement('qrcode')} className="p-3 border rounded-xl bg-white hover:border-[#171C62] hover:text-[#171C62] flex flex-col items-center gap-1.5">
                    <QrCode size={20} /> QR Code
                  </button>
                  <button onClick={() => addSpecialElement('barcode')} className="p-3 border rounded-xl bg-white hover:border-[#171C62] hover:text-[#171C62] flex flex-col items-center gap-1.5">
                    <Barcode size={20} /> Barcode
                  </button>
                </div>
              </div>
            )}

            {/* TAB: AI TOOLS */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">AI Print Tools</h3>
                
                <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-purple-800 font-bold text-sm">
                    <Wand2 size={16} /> Background Removal
                  </div>
                  <p className="text-xxs text-purple-700">Strip the background from client-submitted subject photos.</p>
                  <button onClick={() => runAiTool('background-removal')} className="w-full py-2 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700">
                    Remove Background
                  </button>
                </div>

                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <Focus size={16} /> Image Quality Check
                  </div>
                  <p className="text-xxs text-emerald-700">Run a deep validator against the file parameters to check resolution.</p>
                  <button onClick={() => runAiTool('upscale')} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700">
                    AI Upscale (300 DPI)
                  </button>
                </div>
              </div>
            )}

            {/* TAB: LAYERS MANAGEMENT */}
            {activeTab === 'layers' && (
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Layers List</h3>
                <div className="flex gap-1.5">
                  <button onClick={() => moveLayer('front')} className="flex-1 py-1.5 bg-gray-100 text-xxs font-bold rounded hover:bg-gray-200">To Front</button>
                  <button onClick={() => moveLayer('back')} className="flex-1 py-1.5 bg-gray-100 text-xxs font-bold rounded hover:bg-gray-200">To Back</button>
                  <button onClick={duplicateSelected} disabled={!selectedId} className="p-1.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"><Copy size={12}/></button>
                  <button onClick={deleteSelected} disabled={!selectedId} className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded disabled:opacity-50"><Trash2 size={12}/></button>
                </div>
                
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {items.map((item, idx) => (
                    <div 
                      key={item.id} onClick={() => setSelectedId(item.id)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer ${selectedId === item.id ? 'border-[#171C62] bg-indigo-50/50' : 'border-gray-100 hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xxs text-gray-400 font-bold">#{items.length - idx}</span>
                        <div className="w-7 h-7 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                          {item.type === 'image' ? <img src={item.src} className="w-full h-full object-cover" /> : <Type size={12} />}
                        </div>
                        <span className="text-xs font-semibold text-gray-700 capitalize truncate max-w-[100px]">{item.type}</span>
                      </div>
                      
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setItems(items.map(it => it.id === item.id ? { ...it, visible: it.visible === false ? true : false } : it));
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {item.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Center Canvas Area */}
        <div className={`flex-1 overflow-auto bg-[#E5E7EB] relative ${!(isButterfly(currentOrder) || isMagazine(currentOrder)) ? 'flex flex-col items-center justify-center p-8' : 'p-8 flex'}`}>
          
          {/* Overlays / Guides indicator */}
          <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-2 rounded-xl shadow-sm flex items-center gap-2 z-10 border border-gray-100">
            <span className="w-3.5 h-3.5 border-2 border-green-500 rounded-md"></span>
            <span className="text-xs font-bold text-gray-700">Safe Print Area</span>
            <span className="w-3.5 h-3.5 border-2 border-red-500 border-dashed rounded-md ml-2"></span>
            <span className="text-xs font-bold text-gray-700">Bleed Zone</span>
          </div>

          {/* Canva Dynamic Quick Action Bar */}
          {selectedId && (
            <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-md px-4 py-2 rounded-2xl shadow-lg border border-gray-200/50 flex items-center gap-3.5 z-10 animate-fade-in">
              <span className="text-[10px] font-bold text-gray-400 border-r pr-3.5">CANVA STUDIO</span>
              
              {/* Quick AI actions */}
              <button 
                onClick={() => runAiTool('background-removal')}
                className="text-xs font-semibold text-purple-700 hover:text-purple-800 flex items-center gap-1 bg-purple-50 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg border border-purple-100/50 transition-colors"
                title="Remove background from photo"
              >
                <Wand2 size={13} /> BG Remover
              </button>
              
              <button 
                onClick={() => runAiTool('eraser')}
                className="text-xs font-semibold text-orange-700 hover:text-orange-800 flex items-center gap-1 bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-lg border border-orange-100/50 transition-colors"
                title="Magic eraser"
              >
                <Scissors size={13} /> Eraser
              </button>
              
              <div className="w-px h-5 bg-gray-200" />
              
              {/* Layer Sorting */}
              <button 
                onClick={() => moveLayer('front')}
                className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-900 transition-colors" 
                title="Bring to Front"
              >
                <Layers size={14} />
              </button>
              
              <button 
                onClick={duplicateSelected}
                className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-900 transition-colors" 
                title="Duplicate Element"
              >
                <Copy size={14} />
              </button>
              
              <button 
                onClick={deleteSelected}
                className="p-1.5 hover:bg-red-50 rounded text-red-500 hover:text-red-700 transition-colors" 
                title="Delete Element"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}

          <div className={`relative w-full h-full overflow-auto ${!(isButterfly(currentOrder) || isMagazine(currentOrder)) ? 'flex items-center justify-center' : 'flex'}`}>
            {((isButterfly(currentOrder) || isMagazine(currentOrder))) ? (
              <div id="print-sheet-wrapper" style={{ zoom: scale, margin: 'auto', display: 'flex', justifyContent: 'center' }}>
                {isMagazine(currentOrder) ? (
                  <MagazineSheet 
                    images={(currentOrder.images && currentOrder.images.length > 0) ? currentOrder.images : []} 
                    magazineCrops={butterflyCrops || {}} 
                    orderId={currentOrder.id || currentOrder._id || currentOrder.orderNumber}
                    onSelectPhoto={(idx) => setEditingCropIdx(idx)}
                    forPdf={isGenerating}
                  />
                ) : (
                  <ButterflySheet 
                    images={(currentOrder.images && currentOrder.images.length > 0) ? currentOrder.images : []} 
                    butterflyCrops={butterflyCrops || {}} 
                    orderId={currentOrder.id || currentOrder._id || currentOrder.orderNumber}
                    onSelectPhoto={(idx) => setEditingCropIdx(idx)}
                    forPdf={isGenerating}
                  />
                )}
              </div>
            ) : (
              <div 
                className="bg-white shadow-2xl overflow-hidden relative border border-gray-300"
                style={{ width: 500 * scale, height: 600 * scale }}
              >
                <Stage
                  width={500 * scale}
                  height={600 * scale}
                  scaleX={scale}
                  scaleY={scale}
                  onMouseDown={checkDeselect}
                  onTouchStart={checkDeselect}
                  ref={stageRef}
                >
                  <Layer>
                    {/* Clean Print Canvas Background */}
                    <Rect width={500} height={600} fill="#ffffff" id="bg" />
                    
                    {/* Bleed Area (Red boundary) */}
                    <Rect 
                      x={printArea.x - 10} 
                      y={printArea.y - 10} 
                      width={printArea.width + 20} 
                      height={printArea.height + 20} 
                      stroke="#ef4444" 
                      strokeWidth={1}
                      strokeDasharray={[4, 4]}
                      listening={false}
                    />

                    {/* Safe Print Area (Green boundary) */}
                    <Rect 
                      x={printArea.x} 
                      y={printArea.y} 
                      width={printArea.width} 
                      height={printArea.height} 
                      stroke="#22c55e" 
                      strokeWidth={1.5}
                      listening={false}
                    />

                    {/* Custom Designer Elements */}
                    {items.map((item, i) => {
                      if (!item.visible) return null;
                      
                      if (item.type === 'image') {
                        return (
                          <EditorImage
                            key={item.id}
                            {...item}
                            isSelected={item.id === selectedId}
                            onSelect={() => setSelectedId(item.id)}
                            onChange={(newAttrs: any) => {
                              const newItems = items.slice();
                              newItems[i] = newAttrs;
                              updateItemsAndHistory(newItems);
                            }}
                          />
                        );
                      }
                      
                      if (item.type === 'text') {
                        return (
                          <React.Fragment key={item.id}>
                            <Text
                              ref={(node) => {
                                if (selectedId === item.id && node) {
                                  // Link transformer
                                  (node.getStage()?.findOne('Transformer') as any)?.nodes([node]);
                                }
                              }}
                              onClick={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                              onTap={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                              draggable
                              {...item}
                              onDragEnd={(e) => {
                                const newItems = items.map(it => it.id === item.id ? { ...it, x: e.target.x(), y: e.target.y() } : it);
                                updateItemsAndHistory(newItems);
                              }}
                              onTransformEnd={(e) => {
                                const node = e.target;
                                const newItems = items.map(it => it.id === item.id ? { 
                                  ...it, 
                                  x: node.x(), 
                                  y: node.y(),
                                  fontSize: Math.round((node as any).fontSize() * (node as any).scaleX()),
                                  rotation: node.rotation()
                                } : it);
                                node.scaleX(1);
                                node.scaleY(1);
                                updateItemsAndHistory(newItems);
                              }}
                            />
                            {selectedId === item.id && (
                              <Transformer
                                boundBoxFunc={(oldBox, newBox) => {
                                  return newBox;
                                }}
                              />
                            )}
                          </React.Fragment>
                        );
                      }

                      if (item.type === 'shape') {
                        return (
                          <React.Fragment key={item.id}>
                            {item.shapeType === 'rect' ? (
                              <Rect
                                ref={(node) => {
                                  if (selectedId === item.id && node) (node.getStage()?.findOne('Transformer') as any)?.nodes([node]);
                                }}
                                onClick={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                                onTap={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                                draggable
                                {...item}
                                onDragEnd={(e) => {
                                  const newItems = items.map(it => it.id === item.id ? { ...it, x: e.target.x(), y: e.target.y() } : it);
                                  updateItemsAndHistory(newItems);
                                }}
                                onTransformEnd={(e) => {
                                  const node = e.target;
                                  const newItems = items.map(it => it.id === item.id ? { 
                                    ...it, 
                                    x: node.x(), 
                                    y: node.y(),
                                    width: node.width() * node.scaleX(),
                                    height: node.height() * node.scaleY(),
                                    rotation: node.rotation()
                                  } : it);
                                  node.scaleX(1);
                                  node.scaleY(1);
                                  updateItemsAndHistory(newItems);
                                }}
                              />
                            ) : (
                              <Circle
                                ref={(node) => {
                                  if (selectedId === item.id && node) (node.getStage()?.findOne('Transformer') as any)?.nodes([node]);
                                }}
                                onClick={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                                onTap={(e) => { e.cancelBubble = true; setSelectedId(item.id); }}
                                draggable
                                {...item}
                                radius={item.width / 2}
                                onDragEnd={(e) => {
                                  const newItems = items.map(it => it.id === item.id ? { ...it, x: e.target.x(), y: e.target.y() } : it);
                                  updateItemsAndHistory(newItems);
                                }}
                                onTransformEnd={(e) => {
                                  const node = e.target;
                                  const newItems = items.map(it => it.id === item.id ? { 
                                    ...it, 
                                    x: node.x(), 
                                    y: node.y(),
                                    width: node.width() * node.scaleX(),
                                    height: node.height() * node.scaleY(),
                                    rotation: node.rotation()
                                  } : it);
                                  node.scaleX(1);
                                  node.scaleY(1);
                                  updateItemsAndHistory(newItems);
                                }}
                              />
                            )}
                            {selectedId === item.id && <Transformer />}
                          </React.Fragment>
                        );
                      }
                      return null;
                    })}
                  </Layer>
                </Stage>

                {/* Phone Case Silhouette Overlay */}
                {((currentOrder.productType || '').toLowerCase() === 'mobilecase' || (currentOrder.sku || '').toUpperCase().includes('CASE')) && (
                  <div 
                    style={{ 
                      position: 'absolute', 
                      top: 90 * scale, 
                      left: 140 * scale, 
                      width: 220 * scale, 
                      height: 430 * scale, 
                      border: `${6 * scale}px solid #1e293b`, 
                      borderRadius: `${28 * scale}px`, 
                      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 0 0 1000px rgba(30, 41, 59, 0.05)',
                      pointerEvents: 'none', 
                      zIndex: 50 
                    }}
                  >
                    {/* Camera Bump Cutout */}
                    <div 
                      style={{ 
                        position: 'absolute', 
                        top: `${16 * scale}px`, 
                        left: `${16 * scale}px`, 
                        width: `${75 * scale}px`, 
                        height: `${75 * scale}px`, 
                        background: '#0f172a', 
                        borderRadius: `${14 * scale}px`, 
                        border: `${2 * scale}px solid #334155`, 
                        boxShadow: 'inset 0 4px 6px rgba(0,0,0,0.6)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        padding: `${4 * scale}px`,
                        gap: `${2 * scale}px`,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <div style={{ width: `${20 * scale}px`, height: `${20 * scale}px`, borderRadius: '50%', background: '#1e293b' }} />
                      <div style={{ width: `${20 * scale}px`, height: `${20 * scale}px`, borderRadius: '50%', background: '#1e293b' }} />
                      <div style={{ width: `${14 * scale}px`, height: `${14 * scale}px`, borderRadius: '50%', background: '#1e293b' }} />
                    </div>
                  </div>
                )}
              </div>
            )}
            
          </div>
        </div>

        {/* Right Sidebar: Checklists and resolution warnings */}
        {(!(isButterfly(currentOrder) || isMagazine(currentOrder)) || showTools) && (
          <div className="w-80 bg-white border-l p-5 flex flex-col gap-6 z-10 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Production Quality Check</h3>
            <div className={`p-4 rounded-2xl border flex gap-3 ${resolutionStatus === 'ok' ? 'bg-green-50 border-green-100 text-green-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
              {resolutionStatus === 'ok' ? <CheckCircle size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0 animate-pulse" />}
              <div>
                <div className="font-bold text-xs">Print Resolution</div>
                <div className="text-xxs mt-0.5 font-medium">{dpiDetails}</div>
                {resolutionStatus === 'pending' && (
                  <button onClick={() => runAiTool('upscale')} className="mt-2 text-xxs font-bold underline text-amber-900 block hover:no-underline">
                    Trigger Resolution Upscale
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Live Output Spec Sheet</h3>
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-xs flex flex-col gap-2 font-medium text-gray-600">
              <div className="flex justify-between">
                <span>Output Mode:</span>
                <span className="font-bold text-gray-800">CMYK Coated GRACoL</span>
              </div>
              <div className="flex justify-between">
                <span>Safety Margins:</span>
                <span className="font-bold text-gray-800">0.125 inch Bleed</span>
              </div>
              <div className="flex justify-between">
                <span>Layout Canvas:</span>
                <span className="font-bold text-gray-800">{printArea.width} x {printArea.height} pt</span>
              </div>
              <div className="flex justify-between">
                <span>Vector Elements:</span>
                <span className="font-bold text-[#171C62]">{items.length} layers</span>
              </div>
            </div>
          </div>

          {/* AI Loader overlay */}
          {isAiLoading && (
            <div className="p-3 bg-purple-600 text-white rounded-xl text-xs font-bold animate-pulse text-center">
              {aiMessage}
            </div>
          )}
          </div>
        )}

        {/* Photo Crop Editor Overlay (Fixed relative to viewport) */}
        {editingCropIdx !== null && (
          <div className="absolute top-4 right-4 bg-white p-5 rounded-xl shadow-2xl border border-gray-200 z-50 w-72">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-800">Edit Photo {editingCropIdx + 1}</h3>
              <button 
                onClick={() => setEditingCropIdx(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Scale</label>
                  <span className="text-xs text-gray-400">{Math.round((butterflyCrops[editingCropIdx]?.scale || 1) * 100)}%</span>
                </div>
                <input type="range" min="0.5" max="3" step="0.05" 
                  value={butterflyCrops[editingCropIdx]?.scale || 1}
                  onChange={e => setButterflyCrops(p => ({ ...p, [editingCropIdx]: { ...(p[editingCropIdx] || {x:0, y:0, rotation:0}), scale: Number(e.target.value) } }))}
                  className="w-full accent-indigo-600"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Horizontal Pan</label>
                  <span className="text-xs text-gray-400">{butterflyCrops[editingCropIdx]?.x || 0}</span>
                </div>
                <input type="range" min="-100" max="100" step="1" 
                  value={butterflyCrops[editingCropIdx]?.x || 0}
                  onChange={e => setButterflyCrops(p => ({ ...p, [editingCropIdx]: { ...(p[editingCropIdx] || {scale:1, y:0, rotation:0}), x: Number(e.target.value) } }))}
                  className="w-full accent-indigo-600"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Vertical Pan</label>
                  <span className="text-xs text-gray-400">{butterflyCrops[editingCropIdx]?.y || 0}</span>
                </div>
                <input type="range" min="-100" max="100" step="1" 
                  value={butterflyCrops[editingCropIdx]?.y || 0}
                  onChange={e => setButterflyCrops(p => ({ ...p, [editingCropIdx]: { ...(p[editingCropIdx] || {scale:1, x:0, rotation:0}), y: Number(e.target.value) } }))}
                  className="w-full accent-indigo-600"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Rotation</label>
                  <span className="text-xs text-gray-400">{butterflyCrops[editingCropIdx]?.rotation || 0}°</span>
                </div>
                <input type="range" min="-180" max="180" step="1" 
                  value={butterflyCrops[editingCropIdx]?.rotation || 0}
                  onChange={e => setButterflyCrops(p => ({ ...p, [editingCropIdx]: { ...(p[editingCropIdx] || {scale:1, x:0, y:0}), rotation: Number(e.target.value) } }))}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {showSuccess && (
        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-50 flex items-center justify-center">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-8 rounded-3xl shadow-premium border border-gray-100 flex flex-col items-center max-w-sm text-center"
          >
            <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-4 border border-green-100">
              <Check size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Print-Ready sheet Generated!</h2>
            <p className="text-gray-500 font-medium">The composite vector layout PDF has been saved and routed to the printer queue.</p>
          </motion.div>
        </div>
      )}
    </div>
  );
}

