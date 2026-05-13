import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, X, Check, ArrowRight, RotateCw, Trash2, ChevronLeft, ChevronRight, FileText, Scan } from 'lucide-react';
import { Button, Spinner } from '../common';
import toast from 'react-hot-toast';
import clsx from 'clsx';

/**
 * Perspective Warp Utility
 * Applies a 4-point perspective transform to a canvas.
 */
function applyPerspectiveTransform(srcCanvas, points, width, height) {
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = width;
  dstCanvas.height = height;
  const ctx = dstCanvas.getContext('2d');

  // Simple version: for now we use a bounding box crop if we can't do full perspective without a library
  // But we can try a basic 2D transform or just a high-quality crop
  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxX = Math.max(...points.map(p => p.x));
  const maxY = Math.max(...points.map(p => p.y));
  
  const cropWidth = maxX - minX;
  const cropHeight = maxY - minY;
  
  ctx.drawImage(srcCanvas, minX, minY, cropWidth, cropHeight, 0, 0, width, height);
  return dstCanvas;
}

export default function DocumentScanner({ onComplete, onClose }) {
  const [step, setStep] = useState('camera'); // 'camera' | 'crop' | 'review'
  const [pages, setPages] = useState([]); // Array of { id, originalBlob, croppedBlob, preview }
  const [currentOriginal, setCurrentOriginal] = useState(null); // { blob, url, width, height }
  const [points, setPoints] = useState([]); // 4 points for cropping
  const [isProcessing, setIsProcessing] = useState(false);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Initialize Camera
  useEffect(() => {
    if (step === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [step]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      toast.error('Camera access denied');
      onClose();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      setCurrentOriginal({ blob, url, width: canvas.width, height: canvas.height });
      
      // Default crop points (10% inset)
      const w = canvas.width;
      const h = canvas.height;
      setPoints([
        { x: w * 0.1, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.9 },
        { x: w * 0.1, y: h * 0.9 },
      ]);
      setStep('crop');
    }, 'image/jpeg', 0.9);
  };

  const handleCropComplete = async () => {
    setIsProcessing(true);
    try {
      const img = new Image();
      img.src = currentOriginal.url;
      await new Promise(r => img.onload = r);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = currentOriginal.width;
      srcCanvas.height = currentOriginal.height;
      srcCanvas.getContext('2d').drawImage(img, 0, 0);

      // In a real app, we'd do perspective warp here. 
      // For this implementation, we'll do a high-quality rectangular crop based on the points.
      const minX = Math.min(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxX = Math.max(...points.map(p => p.x));
      const maxY = Math.max(...points.map(p => p.y));
      
      const targetWidth = 1200;
      const targetHeight = (maxY - minY) / (maxX - minX) * targetWidth;

      const dstCanvas = applyPerspectiveTransform(srcCanvas, points, targetWidth, targetHeight);
      
      dstCanvas.toBlob((blob) => {
        const preview = URL.createObjectURL(blob);
        setPages([...pages, { id: Date.now(), originalBlob: currentOriginal.blob, croppedBlob: blob, preview }]);
        setStep('review');
        setIsProcessing(false);
      }, 'image/jpeg', 0.85);
    } catch (err) {
      toast.error('Processing failed');
      setIsProcessing(false);
    }
  };

  const movePage = (index, direction) => {
    const newPages = [...pages];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= pages.length) return;
    [newPages[index], newPages[newIndex]] = [newPages[newIndex], newPages[index]];
    setPages(newPages);
  };

  const deletePage = (index) => {
    URL.revokeObjectURL(pages[index].preview);
    setPages(pages.filter((_, i) => i !== index));
  };

  const finishScan = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    
    try {
      // Use jsPDF from CDN
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const img = new Image();
        img.src = page.preview;
        await new Promise(r => img.onload = r);

        // Calculate dimensions to fit A4
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const imgRatio = img.width / img.height;
        const pageRatio = pageWidth / pageHeight;

        let finalW, finalH;
        if (imgRatio > pageRatio) {
          finalW = pageWidth;
          finalH = pageWidth / imgRatio;
        } else {
          finalH = pageHeight;
          finalW = pageHeight * imgRatio;
        }

        if (i > 0) doc.addPage();
        doc.addImage(img, 'JPEG', (pageWidth - finalW) / 2, (pageHeight - finalH) / 2, finalW, finalH);
      }

      const pdfBlob = doc.output('blob');
      const pdfFile = new File([pdfBlob], `scan_${Date.now()}.pdf`, { type: 'application/pdf' });
      
      onComplete(pdfFile);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('PDF Generation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Render Helpers ─────────────────────────────────────────────────────────

  const renderCamera = () => (
    <div className="relative h-full flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-0 border-[40px] border-black/30 pointer-events-none">
          <div className="w-full h-full border-2 border-white/50 rounded-lg flex items-center justify-center">
            <div className="w-8 h-8 border-t-4 border-l-4 border-blue-500 absolute top-0 left-0" />
            <div className="w-8 h-8 border-t-4 border-r-4 border-blue-500 absolute top-0 right-0" />
            <div className="w-8 h-8 border-b-4 border-l-4 border-blue-500 absolute bottom-0 left-0" />
            <div className="w-8 h-8 border-b-4 border-r-4 border-blue-500 absolute bottom-0 right-0" />
          </div>
        </div>
      </div>
      
      <div className="h-32 bg-black flex items-center justify-around px-6 border-t border-white/10">
        <button onClick={onClose} className="text-white/70 text-sm font-bold">Cancel</button>
        <button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-white p-1">
          <div className="w-full h-full bg-white rounded-full flex items-center justify-center">
             <Scan className="text-black w-8 h-8" />
          </div>
        </button>
        <button onClick={() => pages.length > 0 && setStep('review')} className="relative">
          {pages.length > 0 && (
             <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center overflow-hidden border border-white/30">
               <img src={pages[pages.length-1].preview} className="w-full h-full object-cover opacity-80" />
               <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-black font-bold">
                 {pages.length}
               </span>
             </div>
          )}
        </button>
      </div>
    </div>
  );

  const renderCrop = () => {
    // Basic rectangle crop UI with corner handles
    const containerRef = useRef(null);
    const [draggingIdx, setDraggingIdx] = useState(null);

    const handleTouchMove = (e) => {
      if (draggingIdx === null) return;
      const rect = containerRef.current.getBoundingClientRect();
      const touch = e.touches[0];
      const x = ((touch.clientX - rect.left) / rect.width) * currentOriginal.width;
      const y = ((touch.clientY - rect.top) / rect.height) * currentOriginal.height;
      
      const newPoints = [...points];
      newPoints[draggingIdx] = { 
        x: Math.max(0, Math.min(currentOriginal.width, x)), 
        y: Math.max(0, Math.min(currentOriginal.height, y)) 
      };
      setPoints(newPoints);
    };

    return (
      <div className="h-full flex flex-col bg-gray-900 overflow-hidden">
        <div className="flex-1 relative bg-black flex items-center justify-center p-4">
          <div 
            ref={containerRef}
            className="relative max-w-full max-h-full"
            style={{ aspectRatio: `${currentOriginal.width}/${currentOriginal.height}` }}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => setDraggingIdx(null)}
          >
            <img src={currentOriginal.url} className="w-full h-full object-contain select-none pointer-events-none" />
            
            {/* SVG Overlay for handles and lines */}
            <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
              <polygon 
                points={points.map(p => `${(p.x/currentOriginal.width)*100}%,${(p.y/currentOriginal.height)*100}%`).join(' ')} 
                fill="rgba(59, 130, 246, 0.2)"
                stroke="#3b82f6"
                strokeWidth="2"
              />
              {points.map((p, i) => (
                <circle 
                  key={i}
                  cx={`${(p.x/currentOriginal.width)*100}%`}
                  cy={`${(p.y/currentOriginal.height)*100}%`}
                  r="15"
                  fill="white"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  className="pointer-events-auto cursor-move"
                  style={{ pointerEvents: 'auto' }}
                  onMouseDown={() => setDraggingIdx(i)}
                  onTouchStart={(e) => { e.preventDefault(); setDraggingIdx(i); }}
                />
              ))}
            </svg>
          </div>
          <div className="absolute top-4 left-0 right-0 text-center">
            <span className="bg-blue-600/80 backdrop-blur px-3 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-widest">
              Adjust Corners to Crop
            </span>
          </div>
        </div>
        
        <div className="h-24 bg-gray-900 border-t border-white/10 flex items-center justify-between px-6">
          <button onClick={() => setStep('camera')} className="text-white/60 font-bold text-sm">Retake</button>
          <Button onClick={handleCropComplete} loading={isProcessing}>
            <Check size={18} className="mr-2" /> Next Page
          </Button>
        </div>
      </div>
    );
  };

  const renderReview = () => (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="p-4 border-b bg-white flex items-center justify-between sticky top-0 z-10">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
          <FileText className="text-blue-600" size={18} />
          Scanned Pages ({pages.length})
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {pages.map((page, index) => (
          <div key={page.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex gap-4 p-3 group animate-slide-up">
            <div className="w-24 h-32 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 border">
              <img src={page.preview} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 flex flex-col justify-between py-1">
              <div>
                <p className="text-xs font-black text-blue-600 mb-1">PAGE {index + 1}</p>
                <p className="text-xs text-gray-400">Cropped Document Page</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => movePage(index, -1)} disabled={index === 0} 
                  className="p-2 bg-gray-50 rounded-lg text-gray-400 disabled:opacity-30">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => movePage(index, 1)} disabled={index === pages.length - 1}
                  className="p-2 bg-gray-50 rounded-lg text-gray-400 disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
                <div className="flex-1" />
                <button onClick={() => deletePage(index)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        <button 
          onClick={() => setStep('camera')}
          className="w-full py-4 border-2 border-dashed border-blue-200 rounded-2xl text-blue-600 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"
        >
          <Camera size={18} /> Add More Pages
        </button>
      </div>

      <div className="p-6 bg-white border-t space-y-3">
        <p className="text-[10px] text-center text-gray-400 uppercase tracking-widest font-black">
          "Sliding reorder & serial numbers enabled"
        </p>
        <Button onClick={finishScan} loading={isProcessing} className="w-full py-4 rounded-2xl shadow-lg shadow-blue-200">
           GENERATE PDF & UPLOAD <ArrowRight size={18} className="ml-2" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col overflow-hidden touch-none animate-slide-up">
      {step === 'camera' && renderCamera()}
      {step === 'crop' && renderCrop()}
      {step === 'review' && renderReview()}
    </div>
  );
}
