import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, UploadCloud, X, Image as ImageIcon, Loader2,
  RotateCw, Check, AlertTriangle, RefreshCw
} from 'lucide-react';

import {
  DesignTransform, IDENTITY_TRANSFORM, normalizeTransform, toCssStyle, printAreaStyle, PrintArea
} from '../lib/designTransform';

/**
 * THE PRINK customer upload portal.
 *
 * Reached only via the secure tokenised link (/upload/:token) - no login.
 *
 * Core UX requirement: the product preview is on screen the moment a photo is
 * chosen. The local object URL is placed into the product template
 * immediately, and the network upload happens behind it. The customer never
 * waits for a round trip to see their product.
 *
 * All geometry comes from the SKU-resolved template served by the API, so
 * nothing product-specific is hardcoded here.
 */

interface Template {
  id: string;
  name: string;
  productType: string;
  mockupUrl: string;
  printArea: PrintArea;
  physical: { widthMm: number; heightMm: number; bleedMm: number; safeMm: number };
  dpi: number;
  maxImages: number;
  previewEnabled: boolean;
  minSourcePx: number;
}

interface PortalImage {
  id: string;
  url: string;
  name: string;
  transform: DesignTransform;
  /** Local blob URL shown until the stored copy is available. */
  localUrl?: string;
  status: 'uploading' | 'saved' | 'failed';
  error?: string;
  lowResolution?: boolean;
  effectiveDpi?: number;
  /** Retained so a failed upload can be retried without re-picking the file. */
  file?: File;
}

interface OrderData {
  orderId: string;
  orderNumber: string;
  customerName: string;
  product: string;
  sku: string;
  quantity: number;
  designLocked: boolean;
  images: any[];
  customerNotes: string;
  template: Template;
}

const api = (token: string, suffix = '') => `/api/public/order/${encodeURIComponent(token)}${suffix}`;

export default function UploadPortal() {
  const { token = '' } = useParams<{ token: string }>();

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [images, setImages] = useState<PortalImage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<'editing' | 'reviewing' | 'confirmed'>('editing');
  const [banner, setBanner] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const moveImage = useCallback((index: number, direction: 'left' | 'right') => {
    const targetIdx = direction === 'left' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= images.length) return;
    setImages(prev => {
      const arr = [...prev];
      const [item] = arr.splice(index, 1);
      arr.splice(targetIdx, 0, item);
      return arr;
    });
  }, [images.length]);

  // Revoke every blob URL exactly once, on unmount.
  useEffect(() => () => { objectUrls.current.forEach(URL.revokeObjectURL); }, []);

  /* ---------------------------------------------------------------- */
  /* Load                                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(api(token));
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setLoadError(data.error || 'This upload link could not be opened.');
        } else {
          setOrder(data.order);
          setNotes(data.order.customerNotes || '');
          setStep(data.order.designLocked ? 'confirmed' : 'editing');
          const existing: PortalImage[] = (data.order.images || []).map((img: any) => ({
            id: img.id,
            url: img.url,
            name: img.name,
            transform: normalizeTransform(img.transform),
            status: 'saved' as const,
            lowResolution: img.lowResolution,
            effectiveDpi: img.effectiveDpi
          }));
          setImages(existing);
          setActiveId(existing[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) setLoadError('We could not reach THE PRINK. Please check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const template = order?.template;
  const active = images.find(i => i.id === activeId) || null;
  const savedCount = images.filter(i => i.status !== 'failed').length;
  const canAddMore = !!template && savedCount < template.maxImages && step !== 'confirmed';

  /* ---------------------------------------------------------------- */
  /* Upload - optimistic, keyed by stable id (never array index)       */
  /* ---------------------------------------------------------------- */

  const uploadOne = useCallback(async (file: File, localId: string) => {
    const body = new FormData();
    body.append('image', file);
    try {
      const res = await fetch(api(token, '/upload'), { method: 'POST', body });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setImages(prev => prev.map(i => i.id === localId
          ? { ...i, status: 'failed', error: data.error || 'Upload failed.' }
          : i));
        return;
      }

      // Swap the temporary record for the persisted one, matching on the
      // stable local id so concurrent uploads can finish in any order.
      //
      // The LOCAL transform is kept rather than the server's freshly-created
      // identity one: the customer may have been adjusting the photo while it
      // uploaded, and taking the server value would silently discard those
      // edits and snap the preview back.
      let localTransform = IDENTITY_TRANSFORM;
      setImages(prev => prev.map(i => {
        if (i.id !== localId) return i;
        localTransform = i.transform;
        return {
          ...i,
          id: data.image.id,
          url: data.image.url,
          status: 'saved',
          error: undefined,
          file: undefined,
          lowResolution: data.image.lowResolution,
          effectiveDpi: data.image.effectiveDpi
        };
      }));
      setActiveId(cur => (cur === localId ? data.image.id : cur));

      // Persist any adjustment made while the upload was in flight.
      const t = normalizeTransform(localTransform);
      if (JSON.stringify(t) !== JSON.stringify(IDENTITY_TRANSFORM)) {
        fetch(api(token, `/image/${encodeURIComponent(data.image.id)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transform: t })
        }).catch(() => { /* retried on the next adjustment */ });
      }

      if (data.warnings?.length) setBanner(data.warnings[0]);
    } catch {
      setImages(prev => prev.map(i => i.id === localId
        ? { ...i, status: 'failed', error: 'Network error while uploading.' }
        : i));
    }
  }, [token]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || !files.length || !template) return;
    setBanner(null);

    const room = template.maxImages - savedCount;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (chosen.length < files.length) {
      setBanner(`This product takes up to ${template.maxImages} photo(s); extra files were ignored.`);
    }

    for (const file of chosen) {
      const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const localUrl = URL.createObjectURL(file);
      objectUrls.current.push(localUrl);

      // Placed into the product template on this very tick - no waiting.
      setImages(prev => [...prev, {
        id: localId,
        url: localUrl,
        localUrl,
        name: file.name,
        transform: { ...IDENTITY_TRANSFORM },
        status: 'uploading',
        file
      }]);
      setActiveId(prev => prev ?? localId);
      void uploadOne(file, localId);
    }
  }, [template, savedCount, uploadOne]);

  const retry = useCallback((img: PortalImage) => {
    if (!img.file) return;
    setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'uploading', error: undefined } : i));
    void uploadOne(img.file, img.id);
  }, [uploadOne]);

  /* ---------------------------------------------------------------- */
  /* Transform editing - preview updates instantly, save is debounced  */
  /* ---------------------------------------------------------------- */

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateTransform = useCallback((id: string, patch: Partial<DesignTransform>) => {
    const img = images.find(i => i.id === id);
    if (!img) return;

    // Computed here, not inside the state updater. React may defer or (in
    // StrictMode) double-invoke an updater, so a value assigned inside one is
    // not reliably available afterwards - reading it there meant the PATCH
    // could be skipped and the customer's adjustment never persisted.
    const next = normalizeTransform({ ...img.transform, ...patch });

    setImages(prev => prev.map(i => (i.id === id ? { ...i, transform: next } : i)));

    // Only persisted images can be patched server-side. A still-uploading one
    // keeps its edits locally and saves them on the next adjustment after the
    // upload completes.
    if (img.status !== 'saved') return;

    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      fetch(api(token, `/image/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transform: next })
      }).catch(() => { /* retried on the next adjustment */ });
    }, 400);
  }, [images, token]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const removeImage = useCallback(async (img: PortalImage) => {
    setImages(prev => {
      const next = prev.filter(i => i.id !== img.id);
      setActiveId(cur => (cur === img.id ? next[0]?.id ?? null : cur));
      return next;
    });
    if (img.status === 'saved') {
      await fetch(api(token, `/image/${encodeURIComponent(img.id)}`), { method: 'DELETE' }).catch(() => {});
    }
  }, [token]);

  /* ---------------------------------------------------------------- */
  /* Confirm                                                           */
  /* ---------------------------------------------------------------- */

  const confirmDesign = useCallback(async () => {
    const requiredCount = template ? template.maxImages : 1;
    if (images.some(i => i.status === 'uploading')) {
      setBanner('Please wait for your photos to finish uploading.');
      return;
    }
    if (images.some(i => i.status === 'failed')) {
      setBanner('One of your photos failed to upload. Retry or remove it before confirming.');
      return;
    }
    if (savedCount < requiredCount) {
      setBanner(`This product requires exactly ${requiredCount} photo(s). Please upload ${requiredCount - savedCount} more photo(s) to submit.`);
      return;
    }
    if (savedCount > requiredCount) {
      setBanner(`This product allows a maximum of ${requiredCount} photo(s). Please remove extra photo(s) before confirming.`);
      return;
    }
    setConfirming(true);
    setBanner(null);
    try {
      await fetch(api(token, '/notes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      }).catch(() => {});

      const res = await fetch(api(token, '/confirm'), { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBanner(data.error || 'We could not confirm your design. Please try again.');
        return;
      }
      setStep('confirmed');
    } catch {
      setBanner('Network error while confirming. Please try again.');
    } finally {
      setConfirming(false);
    }
  }, [images, notes, token]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC]">
        <Loader2 className="animate-spin text-[#171C62]" size={32} />
      </div>
    );
  }

  if (loadError || !order || !template) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4">
        <div className="bg-white rounded-3xl shadow-sm border p-8 max-w-md text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
          <h1 className="text-xl font-bold text-gray-900 mb-2">We can't open this link</h1>
          <p className="text-gray-500 text-sm">{loadError}</p>
        </div>
      </div>
    );
  }

  if (step === 'confirmed' || order.designLocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4">
        <div className="bg-white rounded-3xl shadow-sm border p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Design Confirmed & Locked</h1>
          <p className="text-gray-500 text-sm mb-6">
            Thanks {order.customerName}! Your customization for {order.product} (Order #{String(order.orderNumber || order.orderId).replace(/^#/, '')}) is locked in and sent to our print team.
          </p>
          <a
            href="/customer"
            className="w-full py-3 px-6 bg-[#171C62] text-white font-bold text-sm rounded-xl inline-flex items-center justify-center gap-2 shadow-md hover:bg-indigo-900 transition-all text-center"
          >
            Personalise Another Order
          </a>
        </div>
      </div>
    );
  }

  /** The live product preview - shared shape for the main and thumbnail views. */
  const ProductPreview = ({ img, showGuides }: { img: PortalImage | null; showGuides: boolean }) => (
    <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-[#F1F3F9] border">
      <img src={template.mockupUrl} alt={order.product}
           className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none" />

      {/* Geometry comes straight from the template - no hardcoded coordinates. */}
      <div style={printAreaStyle(template.printArea)}
           className={img ? '' : 'border-2 border-dashed border-gray-400 bg-white/40'}>
        {img ? (
          <>
            <img
              src={img.url}
              alt="Your photo on the product"
              className="w-full h-full object-cover"
              style={toCssStyle(img.transform)}
            />
            {showGuides && (
              <>
                <div className="absolute inset-0 pointer-events-none border border-dashed border-red-500/70" />
                <div className="absolute inset-[6%] pointer-events-none border border-green-500/70" />
              </>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1">
            <ImageIcon size={22} />
            <span className="text-[11px] font-semibold text-center px-2">Your photo appears here</span>
          </div>
        )}
      </div>

      {img?.status === 'uploading' && (
        <div className="absolute bottom-3 left-3 bg-white/90 text-[#171C62] text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow">
          <Loader2 size={11} className="animate-spin" /> Saving photo…
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8F9FC] font-sans">
      <header className="bg-white/90 backdrop-blur border-b px-4 sm:px-6 py-4 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black bg-indigo-100 text-[#171C62] px-2.5 py-0.5 rounded-md border border-indigo-200">
                Order #{String(order.orderNumber || order.orderId).replace(/^#/, '')}
              </span>
              <h1 className="text-base sm:text-xl font-bold text-gray-900 truncate">Personalise {order.product}</h1>
            </div>
            <p className="text-xs text-gray-500 truncate mt-1">
              SKU: {order.sku} · Qty: {order.quantity}
            </p>
          </div>
          <button
            onClick={confirmDesign}
            disabled={
              confirming
              || images.some(i => i.status === 'uploading')
              || savedCount < (template?.maxImages || 1)
            }
            className="shrink-0 px-4 sm:px-6 py-2.5 bg-[#171C62] text-white text-sm font-semibold rounded-xl disabled:opacity-40 flex items-center gap-2 shadow-md hover:bg-indigo-900 transition-all"
          >
            {confirming ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span className="hidden sm:inline">{confirming ? 'Confirming…' : 'Confirm design'}</span>
            <span className="sm:hidden">Confirm</span>
          </button>
        </div>
      </header>

      {banner && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 flex gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{banner}</span>
          </div>
        </div>
      )}

      {/* Preview first on mobile so it is visible while choosing a photo. */}
      <main className="max-w-6xl mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="lg:order-2">
          <div className="bg-white rounded-3xl border p-4 sm:p-6 lg:sticky lg:top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Live preview</h2>
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{template.name}</span>
            </div>

            <ProductPreview img={active} showGuides={!!active} />

            {active && (
              <div className="mt-5 space-y-4">
                <Slider label="Zoom" value={active.transform.scale} min={0.5} max={4} step={0.01}
                        display={`${active.transform.scale.toFixed(2)}x`}
                        onChange={v => updateTransform(active.id, { scale: v })} />
                <Slider label="Move left / right" value={active.transform.offsetX} min={-0.5} max={0.5} step={0.005}
                        display={`${Math.round(active.transform.offsetX * 100)}%`}
                        onChange={v => updateTransform(active.id, { offsetX: v })} />
                <Slider label="Move up / down" value={active.transform.offsetY} min={-0.5} max={0.5} step={0.005}
                        display={`${Math.round(active.transform.offsetY * 100)}%`}
                        onChange={v => updateTransform(active.id, { offsetY: v })} />
                <Slider label="Brightness" value={active.transform.brightness} min={50} max={150} step={1}
                        display={`${Math.round(active.transform.brightness)}%`}
                        onChange={v => updateTransform(active.id, { brightness: v })} />
                <Slider label="Contrast" value={active.transform.contrast} min={50} max={150} step={1}
                        display={`${Math.round(active.transform.contrast)}%`}
                        onChange={v => updateTransform(active.id, { contrast: v })} />

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => updateTransform(active.id, { rotation: (active.transform.rotation + 90) % 360 })}
                    className="flex-1 py-2.5 text-sm font-semibold text-gray-700 bg-gray-50 border rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <RotateCw size={15} /> Rotate
                  </button>
                  <button
                    onClick={() => updateTransform(active.id, IDENTITY_TRANSFORM)}
                    className="flex-1 py-2.5 text-sm font-semibold text-gray-700 bg-gray-50 border rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={15} /> Reset
                  </button>
                </div>

                {active.lowResolution && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    This photo prints at about {active.effectiveDpi} DPI. It may look soft at
                    {' '}{template.physical.widthMm}×{template.physical.heightMm}mm.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-4 text-[10px] font-bold text-gray-500 border-t mt-5 pt-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-dashed border-red-500 bg-red-500/10" /> Trim / bleed edge
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-green-500 bg-green-500/10" /> Safe area
              </span>
            </div>
          </div>
        </section>

        <section className="lg:order-1 space-y-4">
          <div className="bg-white rounded-3xl border p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-bold text-gray-900">Your photos</h2>
              <div className="flex items-center gap-2 text-xs font-bold flex-wrap">
                <span className="bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1 rounded-full">
                  Photos Required: {template.maxImages}
                </span>
                <span className={`px-3 py-1 rounded-full border ${
                  savedCount === template.maxImages 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}>
                  Photos Uploaded: {savedCount} of {template.maxImages}
                </span>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple={template.maxImages > 1}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            />

            {canAddMore && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed rounded-2xl p-8 text-center transition-colors border-gray-200 hover:border-[#171C62] hover:bg-indigo-50/30 cursor-pointer"
              >
                <UploadCloud className="mx-auto mb-2 text-[#171C62]" size={26} />
                <span className="block font-bold text-sm text-gray-900">Choose a photo</span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  JPG, PNG, WEBP or HEIC · at least {template.minSourcePx}px
                </span>
              </button>
            )}

            {images.length > 0 && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between text-xs text-gray-500 font-medium">
                  <span>Uploaded Photos ({images.length} of {template.maxImages})</span>
                  <span className="text-[11px] text-indigo-600 font-semibold">Drag or use ← → to reorder</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {images.map((img, idx) => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('text/plain', String(idx)); setDragIndex(idx); }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        if (dragIndex === null || dragIndex === idx) return;
                        setImages(prev => {
                          const arr = [...prev];
                          const [moved] = arr.splice(dragIndex, 1);
                          arr.splice(idx, 0, moved);
                          return arr;
                        });
                        setDragIndex(null);
                      }}
                      onClick={() => setActiveId(img.id)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-move ${
                        activeId === img.id ? 'border-[#171C62] ring-2 ring-indigo-100' : 'border-gray-200'
                      }`}
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover select-none pointer-events-none" />

                      <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded pointer-events-none">
                        #{idx + 1}
                      </span>

                      {img.status === 'uploading' && (
                        <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
                          <Loader2 size={16} className="animate-spin text-[#171C62]" />
                        </span>
                      )}

                      {img.status === 'failed' && (
                        <span
                          onClick={e => { e.stopPropagation(); retry(img); }}
                          className="absolute inset-0 bg-red-600/80 text-white flex flex-col items-center justify-center gap-1 text-[10px] font-bold"
                        >
                          <RefreshCw size={14} /> Retry
                        </span>
                      )}

                      {images.length > 1 && (
                        <div className="absolute bottom-1 left-1 flex gap-1 z-10">
                          {idx > 0 && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); moveImage(idx, 'left'); }}
                              className="bg-black/70 hover:bg-black text-white px-1.5 py-0.5 rounded text-[10px] font-bold shadow"
                              title="Move left"
                            >
                              ←
                            </button>
                          )}
                          {idx < images.length - 1 && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); moveImage(idx, 'right'); }}
                              className="bg-black/70 hover:bg-black text-white px-1.5 py-0.5 rounded text-[10px] font-bold shadow"
                              title="Move right"
                            >
                              →
                            </button>
                          )}
                        </div>
                      )}

                      <span
                        onClick={e => { e.stopPropagation(); void removeImage(img); }}
                        className="absolute top-1 right-1 bg-white/90 text-gray-700 hover:text-red-600 rounded-full p-1 shadow transition-all cursor-pointer z-10"
                        title="Remove photo"
                      >
                        <X size={11} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl border p-4 sm:p-6">
            <label htmlFor="notes" className="block text-sm font-bold text-gray-700 mb-2">
              Anything we should know? (optional)
            </label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="e.g. please keep both faces fully visible"
              className="w-full border rounded-2xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-[#171C62]"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-bold text-gray-500">
        <span>{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[#171C62]"
      />
    </div>
  );
}
