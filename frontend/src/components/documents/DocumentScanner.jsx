import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, X, Check, ArrowRight, RotateCw,
  Trash2, ChevronLeft, ChevronRight, FileText, Scan, ZoomIn
} from 'lucide-react';
import { Button } from '../common';
import toast from 'react-hot-toast';

// ── Perspective crop (bounding-box crop) ─────────────────────────────────────
function applyPerspectiveTransform(srcCanvas, points, width, height) {
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = width;
  dstCanvas.height = height;
  const ctx = dstCanvas.getContext('2d');
  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxX = Math.max(...points.map(p => p.x));
  const maxY = Math.max(...points.map(p => p.y));
  ctx.drawImage(srcCanvas, minX, minY, maxX - minX, maxY - minY, 0, 0, width, height);
  return dstCanvas;
}

export default function DocumentScanner({ onComplete, onClose }) {
  // ── Global step state ───────────────────────────────────────────────────────
  const [step, setStep] = useState('camera'); // 'camera' | 'crop' | 'review'
  const [pages, setPages] = useState([]);
  const [currentOriginal, setCurrentOriginal] = useState(null);
  const [points, setPoints] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [previewPage, setPreviewPage] = useState(null);

  // ── Camera refs ─────────────────────────────────────────────────────────────
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // ── Crop drag refs (all hooks at top level) ─────────────────────────────────
  const cropContainerRef = useRef(null);
  const draggingIdxRef = useRef(null);

  // ── Camera lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'camera') startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [step]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast.error('Camera access denied');
      onClose();
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // ── Capture ─────────────────────────────────────────────────────────────────
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Flash effect
    setFlash(true);
    setTimeout(() => setFlash(false), 250);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) { toast.error('Capture failed'); return; }
      const url = URL.createObjectURL(blob);
      setCurrentOriginal({ blob, url, width: canvas.width, height: canvas.height });
      const w = canvas.width, h = canvas.height;
      setPoints([
        { x: w * 0.08, y: h * 0.08 },
        { x: w * 0.92, y: h * 0.08 },
        { x: w * 0.92, y: h * 0.92 },
        { x: w * 0.08, y: h * 0.92 },
      ]);
      setStep('crop');
    }, 'image/jpeg', 0.92);
  };

  // ── Crop drag helpers ───────────────────────────────────────────────────────
  const getRelativePoint = useCallback((clientX, clientY) => {
    const rect = cropContainerRef.current?.getBoundingClientRect();
    if (!rect || !currentOriginal) return null;
    const x = ((clientX - rect.left) / rect.width) * currentOriginal.width;
    const y = ((clientY - rect.top) / rect.height) * currentOriginal.height;
    return {
      x: Math.max(0, Math.min(currentOriginal.width, x)),
      y: Math.max(0, Math.min(currentOriginal.height, y)),
    };
  }, [currentOriginal]);

  const onMouseDown = (e, idx) => { e.preventDefault(); draggingIdxRef.current = idx; };
  const onMouseMove = useCallback((e) => {
    if (draggingIdxRef.current === null) return;
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    setPoints(prev => { const n = [...prev]; n[draggingIdxRef.current] = pt; return n; });
  }, [getRelativePoint]);
  const onMouseUp = () => { draggingIdxRef.current = null; };

  const onTouchStart = (e, idx) => { e.preventDefault(); draggingIdxRef.current = idx; };
  const onTouchMove = useCallback((e) => {
    if (draggingIdxRef.current === null) return;
    const t = e.touches[0];
    const pt = getRelativePoint(t.clientX, t.clientY);
    if (!pt) return;
    setPoints(prev => { const n = [...prev]; n[draggingIdxRef.current] = pt; return n; });
  }, [getRelativePoint]);
  const onTouchEnd = () => { draggingIdxRef.current = null; };

  // ── Crop complete ───────────────────────────────────────────────────────────
  const handleCropComplete = async () => {
    setIsProcessing(true);
    try {
      const img = new Image();
      img.src = currentOriginal.url;
      await new Promise(r => { img.onload = r; });

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = currentOriginal.width;
      srcCanvas.height = currentOriginal.height;
      srcCanvas.getContext('2d').drawImage(img, 0, 0);

      const minX = Math.min(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxX = Math.max(...points.map(p => p.x));
      const maxY = Math.max(...points.map(p => p.y));
      const targetW = 1200;
      const targetH = ((maxY - minY) / (maxX - minX)) * targetW;

      const dst = applyPerspectiveTransform(srcCanvas, points, targetW, targetH);
      dst.toBlob(blob => {
        const preview = URL.createObjectURL(blob);
        setPages(prev => [...prev, { id: Date.now(), originalBlob: currentOriginal.blob, croppedBlob: blob, preview }]);
        toast.success(`Page ${pages.length + 1} scanned! ✅`);
        setStep('review');
        setIsProcessing(false);
      }, 'image/jpeg', 0.88);
    } catch (err) {
      console.error(err);
      toast.error('Processing failed');
      setIsProcessing(false);
    }
  };

  // ── Page management ─────────────────────────────────────────────────────────
  const movePage = (index, dir) => {
    const next = index + dir;
    if (next < 0 || next >= pages.length) return;
    setPages(prev => {
      const n = [...prev];
      [n[index], n[next]] = [n[next], n[index]];
      return n;
    });
  };

  const deletePage = (index) => {
    URL.revokeObjectURL(pages[index].preview);
    setPages(prev => prev.filter((_, i) => i !== index));
  };

  // ── Finish / PDF ────────────────────────────────────────────────────────────
  const finishScan = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const { jsPDF } = window.jspdf;
      if (!jsPDF) throw new Error('jsPDF not loaded');
      const doc = new jsPDF();

      for (let i = 0; i < pages.length; i++) {
        const img = new Image();
        img.src = pages[i].preview;
        await new Promise(r => { img.onload = r; });

        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        const ratio = img.width / img.height;
        let fw, fh;
        if (ratio > pw / ph) { fw = pw; fh = pw / ratio; }
        else { fh = ph; fw = ph * ratio; }

        if (i > 0) doc.addPage();
        doc.addImage(img, 'JPEG', (pw - fw) / 2, (ph - fh) / 2, fw, fh);
      }

      const pdfBlob = doc.output('blob');
      const pdfFile = new File([pdfBlob], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
      onComplete(pdfFile);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('PDF generation failed. Make sure jsPDF is loaded.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── RENDER: Camera ──────────────────────────────────────────────────────────
  const renderCamera = () => (
    <div className="relative h-full flex flex-col bg-black">
      {/* Flash overlay */}
      {flash && <div className="absolute inset-0 bg-white z-50 pointer-events-none" style={{ opacity: 0.7 }} />}

      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

        {/* Scan guide overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 60px rgba(0,0,0,0.45)' }}>
          <div className="absolute inset-[60px] border border-white/30 rounded-lg">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-sm" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-sm" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-sm" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-sm" />
          </div>
        </div>

        {/* Top label */}
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <span className="bg-black/50 backdrop-blur-sm px-4 py-1.5 rounded-full text-white text-xs font-semibold tracking-wider">
            📄 Position document in frame
          </span>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="h-32 bg-black flex items-center justify-around px-6 border-t border-white/10">
        <button
          onClick={onClose}
          className="text-white/70 text-sm font-bold px-3 py-2 rounded-xl hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>

        {/* Shutter button */}
        <button
          onClick={capturePhoto}
          className="w-20 h-20 rounded-full border-4 border-white p-1.5 active:scale-95 transition-transform"
        >
          <div className="w-full h-full bg-white rounded-full flex items-center justify-center shadow-lg">
            <Scan className="text-black w-8 h-8" />
          </div>
        </button>

        {/* Thumbnail of last scanned page */}
        <button
          onClick={() => pages.length > 0 && setStep('review')}
          className="relative w-14 h-14"
        >
          {pages.length > 0 ? (
            <>
              <div className="w-full h-full bg-white/10 rounded-xl overflow-hidden border-2 border-white/40">
                <img src={pages[pages.length - 1].preview} className="w-full h-full object-cover" alt="last page" />
              </div>
              <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-black font-bold">
                {pages.length}
              </span>
            </>
          ) : (
            <div className="w-full h-full rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center">
              <FileText className="text-white/30 w-5 h-5" />
            </div>
          )}
        </button>
      </div>
    </div>
  );

  // ── RENDER: Crop ────────────────────────────────────────────────────────────
  const renderCrop = () => {
    if (!currentOriginal) return null;
    const { width: iw, height: ih } = currentOriginal;
    const toPercent = (val, total) => `${(val / total) * 100}%`;

    return (
      <div className="h-full flex flex-col bg-gray-950">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-white/10">
          <span className="text-white font-bold text-sm">✂️ Adjust Crop</span>
          <span className="text-xs text-gray-400">Drag corners to select document area</span>
        </div>

        {/* Image + crop handles */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden p-4">
          <div
            ref={cropContainerRef}
            className="relative select-none"
            style={{ maxHeight: '100%', maxWidth: '100%', aspectRatio: `${iw}/${ih}`, cursor: 'crosshair' }}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <img
              src={currentOriginal.url}
              className="w-full h-full object-contain pointer-events-none"
              style={{ display: 'block' }}
              alt="captured"
            />

            {/* SVG overlay */}
            <svg className="absolute inset-0 w-full h-full overflow-visible">
              {/* Dark mask outside polygon */}
              <defs>
                <mask id="cropMask">
                  <rect width="100%" height="100%" fill="white" />
                  <polygon
                    points={points.map(p => `${toPercent(p.x, iw)},${toPercent(p.y, ih)}`).join(' ')}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#cropMask)" />

              {/* Selection polygon */}
              <polygon
                points={points.map(p => `${toPercent(p.x, iw)},${toPercent(p.y, ih)}`).join(' ')}
                fill="rgba(59,130,246,0.15)"
                stroke="#60a5fa"
                strokeWidth="2"
              />

              {/* Edge lines */}
              {points.map((p, i) => {
                const next = points[(i + 1) % 4];
                return (
                  <line
                    key={`line-${i}`}
                    x1={toPercent(p.x, iw)} y1={toPercent(p.y, ih)}
                    x2={toPercent(next.x, iw)} y2={toPercent(next.y, ih)}
                    stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="6 3"
                  />
                );
              })}

              {/* Corner handles */}
              {points.map((p, i) => (
                <g key={`handle-${i}`}>
                  <circle
                    cx={toPercent(p.x, iw)}
                    cy={toPercent(p.y, ih)}
                    r="18"
                    fill="transparent"
                    style={{ cursor: 'move', pointerEvents: 'all' }}
                    onMouseDown={e => onMouseDown(e, i)}
                    onTouchStart={e => onTouchStart(e, i)}
                  />
                  <circle
                    cx={toPercent(p.x, iw)}
                    cy={toPercent(p.y, ih)}
                    r="10"
                    fill="white"
                    stroke="#3b82f6"
                    strokeWidth="3"
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle
                    cx={toPercent(p.x, iw)}
                    cy={toPercent(p.y, ih)}
                    r="4"
                    fill="#3b82f6"
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Footer controls */}
        <div className="h-24 bg-gray-900 border-t border-white/10 flex items-center justify-between px-6">
          <button
            onClick={() => setStep('camera')}
            className="flex items-center gap-2 text-white/60 font-bold text-sm hover:text-white transition-colors"
          >
            <RotateCw size={16} /> Retake
          </button>
          <Button onClick={handleCropComplete} loading={isProcessing}>
            <Check size={18} className="mr-2" /> Confirm Page
          </Button>
        </div>
      </div>
    );
  };

  // ── RENDER: Review ──────────────────────────────────────────────────────────
  const renderReview = () => (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="px-5 py-4 bg-white border-b flex items-center justify-between shadow-sm">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
          <FileText className="text-blue-600" size={18} />
          Scanned Pages
          <span className="ml-1 bg-blue-100 text-blue-600 text-xs font-black px-2 py-0.5 rounded-full">
            {pages.length}
          </span>
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Page list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <FileText size={48} className="opacity-30" />
            <p className="text-sm font-medium">No pages scanned yet</p>
          </div>
        ) : (
          pages.map((page, index) => (
            <div
              key={page.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex gap-3 p-3"
            >
              {/* Thumbnail */}
              <button
                onClick={() => setPreviewPage(page.preview)}
                className="relative w-24 h-32 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0 border border-gray-200 group"
              >
                <img src={page.preview} className="w-full h-full object-cover" alt={`Page ${index + 1}`} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-opacity" size={20} />
                </div>
              </button>

              {/* Info + controls */}
              <div className="flex-1 flex flex-col justify-between py-1">
                <div>
                  <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Page {index + 1}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Tap thumbnail to preview</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => movePage(index, -1)}
                    disabled={index === 0}
                    className="p-2 bg-gray-50 rounded-lg text-gray-500 disabled:opacity-30 hover:bg-gray-100 transition-colors"
                    title="Move up"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => movePage(index, 1)}
                    disabled={index === pages.length - 1}
                    className="p-2 bg-gray-50 rounded-lg text-gray-500 disabled:opacity-30 hover:bg-gray-100 transition-colors"
                    title="Move down"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => deletePage(index)}
                    className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete page"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Add more */}
        <button
          onClick={() => setStep('camera')}
          className="w-full py-4 border-2 border-dashed border-blue-200 rounded-2xl text-blue-600 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"
        >
          <Camera size={18} /> Add Another Page
        </button>
      </div>

      {/* Footer */}
      <div className="p-5 bg-white border-t space-y-3">
        <Button
          onClick={finishScan}
          loading={isProcessing}
          disabled={pages.length === 0}
          className="w-full py-4 rounded-2xl"
        >
          Generate PDF &amp; Upload <ArrowRight size={18} className="ml-2" />
        </Button>
      </div>

      {/* Full-page preview modal */}
      {previewPage && (
        <div
          className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewPage(null)}
        >
          <img src={previewPage} className="max-w-full max-h-full rounded-xl shadow-2xl object-contain" alt="preview" />
          <button
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 rounded-full p-2 text-white transition-colors"
            onClick={() => setPreviewPage(null)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );

  // ── Root Portal ─────────────────────────────────────────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col overflow-hidden touch-none"
      style={{ height: '100dvh' }}
    >
      {step === 'camera' && renderCamera()}
      {step === 'crop'   && renderCrop()}
      {step === 'review' && renderReview()}
    </div>,
    document.body
  );
}
