import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, X, Check, ArrowRight, RotateCw,
  Trash2, ChevronLeft, ChevronRight, FileText, Scan, ZoomIn, GripVertical,
  Eye, EyeOff, ArrowLeftRight, Zap, ZapOff
} from 'lucide-react';
import { Button } from '../common';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  MouseSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';

// ── OpenCV Helper Functions ──────────────────────────────────────────────────

function applyPerspectiveTransformCV(cv, srcCanvas, points, targetWidth, targetHeight) {
  let src = cv.imread(srcCanvas);
  let dst = new cv.Mat();
  let dsize = new cv.Size(targetWidth, targetHeight);

  // Construct source points
  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    points[0].x, points[0].y,
    points[1].x, points[1].y,
    points[2].x, points[2].y,
    points[3].x, points[3].y
  ]);

  // Construct target points
  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    targetWidth, 0,
    targetWidth, targetHeight,
    0, targetHeight
  ]);

  // Get transformation matrix and warp
  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  // Create destination canvas
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = targetWidth;
  dstCanvas.height = targetHeight;
  cv.imshow(dstCanvas, dst);

  // Cleanup
  src.delete();
  dst.delete();
  M.delete();
  srcTri.delete();
  dstTri.delete();

  return dstCanvas;
}

/**
 * Order 4 points as [top-left, top-right, bottom-right, bottom-left]
 * using sum (x+y) and difference (x-y) — mathematically robust.
 */
function orderPoints(pts) {
  if (pts.length !== 4) return null;
  const sums = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.x - p.y);
  const tlIdx = sums.indexOf(Math.min(...sums));
  const brIdx = sums.indexOf(Math.max(...sums));
  const trIdx = diffs.indexOf(Math.max(...diffs));
  const blIdx = diffs.indexOf(Math.min(...diffs));
  if (new Set([tlIdx, brIdx, trIdx, blIdx]).size !== 4) return null;
  return [pts[tlIdx], pts[trIdx], pts[brIdx], pts[blIdx]];
}

/**
 * Extract the best quadrilateral from a set of contours.
 * Tries multiple epsilon values for approxPolyDP + convex hull fallback.
 */
function findBestQuadInContours(cv, contours, imgW, imgH) {
  const frameArea = imgW * imgH;
  const minArea = frameArea * 0.04;
  const epsilons = [0.02, 0.03, 0.04, 0.06, 0.08];
  let best = null;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < minArea) continue;

    // Try multiple epsilon values
    for (const eps of epsilons) {
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, eps * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = [];
        for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        const ordered = orderPoints(pts);
        if (ordered) {
          const score = area / frameArea;
          if (!best || score > best.score) best = { points: ordered, score, area };
        }
      }
      approx.delete();
    }

    // Convex hull fallback for large irregular contours
    if (area > minArea * 2) {
      const hull = new cv.Mat();
      cv.convexHull(cnt, hull);
      if (hull.rows >= 4) {
        for (const eps of [0.05, 0.08, 0.10]) {
          const peri = cv.arcLength(hull, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(hull, approx, eps * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const pts = [];
            for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
            const ordered = orderPoints(pts);
            if (ordered) {
              const score = (area / frameArea) * 0.8;
              if (!best || score > best.score) best = { points: ordered, score, area };
            }
          }
          approx.delete();
        }
      }
      hull.delete();
    }
  }
  return best;
}

/** Helper to safely run a detection strategy and collect results. */
function runStrategy(fn, allResults) {
  try { const r = fn(); if (r) allResults.push(r); } catch (e) { console.warn('Edge strategy failed:', e); }
}

/**
 * Multi-strategy document edge detection pipeline (Professional Macro-Detection).
 * Returns { points, score, confidence } or null.
 */
function detectDocumentEdges(cv, canvas, w, h) {
  let src = null, smallSrc = null, paddedSrc = null, gray = null;
  const allResults = [];
  const maxDim = 500;
  let scale = 1;
  const PAD = 10; // 10px artificial boundary padding

  try {
    src = cv.imread(canvas);
    
    // 1. Professional Macro-Detection Downscaling
    // By shrinking the image, we destroy micro-noise (text, wood grain)
    // and keep only the strong outer paper boundaries.
    scale = Math.max(w, h) / maxDim;
    if (scale < 1) scale = 1;
    
    const smallW = Math.round(w / scale);
    const smallH = Math.round(h / scale);
    
    smallSrc = new cv.Mat();
    cv.resize(src, smallSrc, new cv.Size(smallW, smallH), 0, 0, cv.INTER_AREA);
    
    // 2. Artificial Boundary Padding
    // This forces documents touching the edge of the screen to form closed contours.
    paddedSrc = new cv.Mat();
    cv.copyMakeBorder(smallSrc, paddedSrc, PAD, PAD, PAD, PAD, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));
    
    gray = new cv.Mat();
    cv.cvtColor(paddedSrc, gray, cv.COLOR_RGBA2GRAY);

    const paddedW = smallW + (PAD * 2);
    const paddedH = smallH + (PAD * 2);

    // Strategy 1: Adaptive Threshold + Morphological Close (best for uneven lighting)
    runStrategy(() => {
      const blur = new cv.Mat(), thresh = new cv.Mat(), morphed = new cv.Mat();
      const c1 = new cv.MatVector(), h1 = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
      const k1 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(thresh, morphed, cv.MORPH_CLOSE, k1);
      cv.findContours(morphed, c1, h1, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const r = findBestQuadInContours(cv, c1, paddedW, paddedH);
      blur.delete(); thresh.delete(); morphed.delete(); k1.delete(); c1.delete(); h1.delete();
      return r;
    }, allResults);

    // Strategy 2: Multi-threshold Canny + Dilate (varying contrast)
    for (const [lo, hi] of [[20, 80], [30, 130], [50, 200], [75, 300]]) {
      runStrategy(() => {
        const blur = new cv.Mat(), edges = new cv.Mat(), dil = new cv.Mat();
        const c2 = new cv.MatVector(), h2 = new cv.Mat();
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.Canny(blur, edges, lo, hi);
        const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.dilate(edges, dil, k2, new cv.Point(-1, -1), 1);
        cv.findContours(dil, c2, h2, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        const r = findBestQuadInContours(cv, c2, paddedW, paddedH);
        blur.delete(); edges.delete(); dil.delete(); k2.delete(); c2.delete(); h2.delete();
        return r;
      }, allResults);
    }

    // Strategy 3: OTSU Threshold (good for high-contrast docs)
    runStrategy(() => {
      const blur = new cv.Mat(), otsu = new cv.Mat(), morphed = new cv.Mat();
      const c3 = new cv.MatVector(), h3 = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.threshold(blur, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(otsu, morphed, cv.MORPH_CLOSE, k3);
      cv.findContours(morphed, c3, h3, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const r = findBestQuadInContours(cv, c3, paddedW, paddedH);
      blur.delete(); otsu.delete(); morphed.delete(); k3.delete(); c3.delete(); h3.delete();
      return r;
    }, allResults);

    // Strategy 4: Heavy Blur + OTSU (Harsh Shadow Fallback)
    runStrategy(() => {
      const blur = new cv.Mat(), thresh = new cv.Mat(), dil = new cv.Mat(), ero = new cv.Mat();
      const c4 = new cv.MatVector(), h4 = new cv.Mat();
      // Massive blur to merge the white paper and ignore the shadow
      cv.GaussianBlur(gray, blur, new cv.Size(21, 21), 0);
      cv.threshold(blur, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      const k4 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
      cv.dilate(thresh, dil, k4, new cv.Point(-1, -1), 1);
      cv.erode(dil, ero, k4, new cv.Point(-1, -1), 1);
      cv.findContours(ero, c4, h4, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const r = findBestQuadInContours(cv, c4, paddedW, paddedH);
      blur.delete(); thresh.delete(); dil.delete(); ero.delete(); k4.delete(); c4.delete(); h4.delete();
      return r;
    }, allResults);

  } finally {
    if (src) src.delete();
    if (smallSrc) smallSrc.delete();
    if (paddedSrc) paddedSrc.delete();
    if (gray) gray.delete();
  }

  if (allResults.length === 0) return null;
  
  // Sort and select the best quad based on our scoring mechanism
  allResults.sort((a, b) => b.score - a.score);
  const best = allResults[0];
  
  // Remove the padding and scale the detected points back to original high-res size
  const upscaledPoints = best.points.map(p => {
    // Subtract padding and clamp to ensure we don't go out of original bounds
    let adjustedX = p.x - PAD;
    let adjustedY = p.y - PAD;
    
    // Convert back to original scale
    let finalX = adjustedX * scale;
    let finalY = adjustedY * scale;
    
    return {
      x: Math.max(0, Math.min(w, finalX)),
      y: Math.max(0, Math.min(h, finalY))
    };
  });
  
  // Calculate confidence based on the area of the document relative to the small frame
  const confidence = (best.area / ((w/scale) * (h/scale))) > 0.25 ? 'high' : 'medium';
  
  return {
    points: upscaledPoints,
    score: best.score,
    confidence
  };
}

/**
 * Post-process a cropped document canvas: brightness/contrast + sharpening.
 */
function enhanceCroppedDocument(cv, canvas) {
  let enhanced = null, adjusted = null, sharpened = null, kernel = null;
  try {
    enhanced = cv.imread(canvas);
    adjusted = new cv.Mat();
    enhanced.convertTo(adjusted, -1, 1.15, 8); // Slight brightness/contrast boost

    sharpened = new cv.Mat();
    kernel = cv.matFromArray(3, 3, cv.CV_32FC1, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
    cv.filter2D(adjusted, sharpened, -1, kernel, new cv.Point(-1, -1), 0, cv.BORDER_DEFAULT);

    cv.imshow(canvas, sharpened);
  } catch (e) {
    console.warn('Post-processing enhancement failed:', e);
  } finally {
    if (enhanced) enhanced.delete();
    if (adjusted) adjusted.delete();
    if (sharpened) sharpened.delete();
    if (kernel) kernel.delete();
  }
}

// ── Sortable Item Component for Review Grid ──────────────────────────────────
function SortablePage({ page, index, onPreview, onDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.2 : 1, // Dim the original as a placeholder
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative w-full aspect-[3/4] flex-shrink-0 touch-none outline-none"
    >
      <button
        type="button"
        onPointerDown={(e) => { e.stopPropagation(); }} // Important: so clicking doesn't start drag immediately
        onClick={() => onPreview(page.preview)}
        className="w-full h-full bg-gray-100 rounded-xl overflow-hidden border border-gray-200 group relative"
      >
        <img src={page.preview} className="w-full h-full object-cover pointer-events-none" alt={`Page ${index + 1}`} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
          <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-opacity" size={20} />
        </div>
        <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm pointer-events-none">
          {index + 1}
        </div>
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()} // Prevent drag start when hitting delete
        onClick={(e) => { e.stopPropagation(); onDelete(index); }}
        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 transition-colors z-10"
      >
        <X size={14} />
      </button>
    </div>
  );
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
  const [videoReady, setVideoReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [magnifier, setMagnifier] = useState(null);
  const [activeId, setActiveId] = useState(null); // For drag overlay
  const [livePreviewUrl, setLivePreviewUrl] = useState(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [previewSide, setPreviewSide] = useState('right'); // 'right' | 'left'
  const [autoDetected, setAutoDetected] = useState(false); // false | 'high' | 'medium' — detection confidence
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // ── Camera refs ─────────────────────────────────────────────────────────────
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // ── Crop drag refs (all hooks at top level) ─────────────────────────────────
  const cropContainerRef = useRef(null);
  const draggingIdxRef = useRef(null);
  const dragStartRef = useRef(null);
  const dragPointsStartRef = useRef(null);
  const lastMousePtRef = useRef(null);

  // ── OpenCV initialization ───────────────────────────────────────────────────
  useEffect(() => {
    const checkCV = () => {
      if (window.cv && window.cv.Mat) {
        setCvReady(true);
      } else {
        setTimeout(checkCV, 500);
      }
    };
    checkCV();
  }, []);

  // ── Camera lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'camera') {
      setVideoReady(false);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [step]);

  const videoCallbackRef = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
    }
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = track.getCapabilities();
          if (capabilities.torch) {
            setHasTorch(true);
          }
        } catch (e) {
          // getCapabilities might not be supported
        }
      }
    } catch {
      toast.error('Camera access denied');
      onClose();
    }
  };

  const stopCamera = () => {
    setVideoReady(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
        setTorchOn(!torchOn);
      } catch (err) {
        console.error("Torch error", err);
      }
    }
  };

  // ── Capture & Auto-detect Edges ─────────────────────────────────────────────
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    if (pages.length >= 20) {
      toast.error('Maximum 20 pages allowed per scan');
      return;
    }

    setFlash(true);
    setTimeout(() => setFlash(false), 250);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) { toast.error('Capture failed'); return; }
      const url = URL.createObjectURL(blob);
      const w = canvas.width;
      const h = canvas.height;
      
      setCurrentOriginal({ blob, url, width: w, height: h });
      
      // Default crop corners (fallback if detection fails)
      let bestPoints = [
        { x: w * 0.1, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.1 },
        { x: w * 0.9, y: h * 0.9 },
        { x: w * 0.1, y: h * 0.9 },
      ];

      // Multi-strategy auto edge detection
      if (cvReady && window.cv) {
        try {
          const result = detectDocumentEdges(window.cv, canvas, w, h);
          if (result && result.points) {
            bestPoints = result.points;
            setAutoDetected(result.confidence || 'medium');
            console.log(`Document detected (confidence: ${result.confidence}, score: ${(result.score * 100).toFixed(1)}%)`);
          }
        } catch (e) {
          console.error('OpenCV Auto-crop failed, falling back to default', e);
        }
      }

      setPoints(bestPoints);
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

  const handleDragMove = useCallback((pt, clientX, clientY) => {
    if (typeof draggingIdxRef.current === 'number') {
      setPoints(prev => { const n = [...prev]; n[draggingIdxRef.current] = pt; return n; });
    } else {
      const prevMousePt = lastMousePtRef.current;
      if (prevMousePt) {
        const dx = pt.x - prevMousePt.x;
        const dy = pt.y - prevMousePt.y;
        setPoints(prev => {
          const n = [...prev];
          if (draggingIdxRef.current === 'left') {
            n[3] = { ...n[3], x: n[3].x + dx };
            n[0] = { ...n[0], x: n[0].x + dx };
          } else if (draggingIdxRef.current === 'right') {
            n[1] = { ...n[1], x: n[1].x + dx };
            n[2] = { ...n[2], x: n[2].x + dx };
          } else if (draggingIdxRef.current === 'top') {
            n[0] = { ...n[0], y: n[0].y + dy };
            n[1] = { ...n[1], y: n[1].y + dy };
          } else if (draggingIdxRef.current === 'bottom') {
            n[2] = { ...n[2], y: n[2].y + dy };
            n[3] = { ...n[3], y: n[3].y + dy };
          }
          const clamp = (p) => ({
             x: Math.max(0, Math.min(currentOriginal.width, p.x)),
             y: Math.max(0, Math.min(currentOriginal.height, p.y))
          });
          return n.map(clamp);
        });
        lastMousePtRef.current = pt;
      }
    }
    setMagnifier({ x: clientX, y: clientY, ptX: pt.x, ptY: pt.y });
  }, [currentOriginal]);

  const onMouseDown = (e, idx) => { 
    e.preventDefault(); 
    draggingIdxRef.current = idx;
    const pt = getRelativePoint(e.clientX, e.clientY);
    dragStartRef.current = pt;
    dragPointsStartRef.current = [...points];
    lastMousePtRef.current = pt;
    setIsDraggingHandle(true); 
  };
  const onMouseMove = useCallback((e) => {
    if (draggingIdxRef.current === null) return;
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    handleDragMove(pt, e.clientX, e.clientY);
  }, [getRelativePoint, handleDragMove]);
  const onMouseUp = () => { 
    draggingIdxRef.current = null; 
    setMagnifier(null); 
    setIsDraggingHandle(false); 
  };

  const onTouchStart = (e, idx) => { 
    e.preventDefault(); 
    draggingIdxRef.current = idx;
    const t = e.touches[0];
    const pt = getRelativePoint(t.clientX, t.clientY);
    dragStartRef.current = pt;
    dragPointsStartRef.current = [...points];
    lastMousePtRef.current = pt;
    setIsDraggingHandle(true); 
  };
  const onTouchMove = useCallback((e) => {
    if (draggingIdxRef.current === null) return;
    const t = e.touches[0];
    const pt = getRelativePoint(t.clientX, t.clientY);
    if (!pt) return;
    handleDragMove(pt, t.clientX, t.clientY);
  }, [getRelativePoint, handleDragMove]);
  const onTouchEnd = () => { 
    draggingIdxRef.current = null; 
    setMagnifier(null); 
    setIsDraggingHandle(false); 
  };

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

      // Target aspect ratio logic (approx A4)
      const tl = points[0], tr = points[1], br = points[2], bl = points[3];
      const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
      let targetW = Math.max(widthTop, widthBottom);
      
      const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
      const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
      let targetH = Math.max(heightLeft, heightRight);

      // Downscale high-resolution canvases to a max of 1600px to ensure the final merged PDF stays under 1.5MB
      const maxDim = 1600;
      if (targetW > maxDim || targetH > maxDim) {
        const scale = maxDim / Math.max(targetW, targetH);
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetH * scale);
      }

      // Use OpenCV if available, else fallback to standard canvas scaling
      let dstCanvas;
      if (cvReady && window.cv) {
        dstCanvas = applyPerspectiveTransformCV(window.cv, srcCanvas, points, targetW, targetH);
        // Post-processing: enhance brightness/contrast + sharpen text
        enhanceCroppedDocument(window.cv, dstCanvas);
      } else {
        dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetW; dstCanvas.height = targetH;
        const ctx = dstCanvas.getContext('2d');
        const minX = Math.min(tl.x, bl.x);
        const minY = Math.min(tl.y, tr.y);
        const maxX = Math.max(tr.x, br.x);
        const maxY = Math.max(bl.y, br.y);
        ctx.drawImage(srcCanvas, minX, minY, maxX - minX, maxY - minY, 0, 0, targetW, targetH);
      }

      dstCanvas.toBlob(blob => {
        const preview = URL.createObjectURL(blob);
        setPages(prev => [...prev, { 
          id: Date.now(), 
          originalBlob: currentOriginal.blob, 
          croppedBlob: blob, 
          preview
        }]);
        toast.success(`Page ${pages.length + 1} scanned! ✅`);
        setStep('review');
        setIsProcessing(false);
      }, 'image/jpeg', 0.75);
    } catch (err) {
      console.error(err);
      toast.error('Processing failed');
      setIsProcessing(false);
    }
  };

  // ── Live Preview logic ─────────────────────────────────────────────────────
  useEffect(() => {
    if (step === 'crop' && currentOriginal && cvReady && window.cv && points.length === 4) {
      const updateLivePreview = async () => {
        try {
          const img = new Image();
          img.src = currentOriginal.url;
          await new Promise(r => { img.onload = r; });

          const srcCanvas = document.createElement('canvas');
          // Use a smaller canvas for live preview to keep it fast
          const scale = 0.3; 
          srcCanvas.width = currentOriginal.width * scale;
          srcCanvas.height = currentOriginal.height * scale;
          const ctx = srcCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0, srcCanvas.width, srcCanvas.height);

          const scaledPoints = points.map(p => ({ x: p.x * scale, y: p.y * scale }));
          
          const tl = scaledPoints[0], tr = scaledPoints[1], br = scaledPoints[2], bl = scaledPoints[3];
          const targetW = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y));
          const targetH = Math.max(Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y));

          const dstCanvas = applyPerspectiveTransformCV(window.cv, srcCanvas, scaledPoints, targetW, targetH);
          
          if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
          dstCanvas.toBlob(blob => {
            setLivePreviewUrl(URL.createObjectURL(blob));
          }, 'image/jpeg', 0.7);
        } catch (err) {
          console.error("Live preview failed", err);
        }
      };

      const timer = setTimeout(updateLivePreview, 100);
      return () => clearTimeout(timer);
    }
  }, [step, points, cvReady]);

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

      // Helper function to compress cropped page canvas to a specific quality and max size
      const compressPageImage = async (pagePreviewUrl, targetQuality, maxDimension) => {
        const img = new Image();
        img.src = pagePreviewUrl;
        await new Promise(r => { img.onload = r; });
        
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        
        if (w > maxDimension || h > maxDimension) {
          const scale = maxDimension / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        
        return new Promise(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', targetQuality);
        });
      };

      // Quality scale levels to step down until the PDF fits under 1MB
      const qualityLevels = [
        { qual: 0.85, dim: 1600 }, // High quality
        { qual: 0.70, dim: 1200 }, // Medium quality
        { qual: 0.55, dim: 1000 }, // Low quality
        { qual: 0.40, dim: 800 },  // Super compressed (very readable for documents)
        { qual: 0.30, dim: 600 }   // Extreme compression (ensures 10+ pages fit under 1MB)
      ];

      let pdfBlob = null;
      const targetMax = 1.95 * 1024 * 1024; // 1.95MB to guarantee < 2MB

      for (let levelIndex = 0; levelIndex < qualityLevels.length; levelIndex++) {
        const { qual, dim } = qualityLevels[levelIndex];
        const doc = new jsPDF();
        
        console.log(`Generating PDF attempt ${levelIndex + 1} with quality ${qual} and maxDim ${dim}...`);

        for (let i = 0; i < pages.length; i++) {
          // Re-compress image dynamically for this attempt
          const compressedBlob = await compressPageImage(pages[i].preview, qual, dim);
          const compressedUrl = URL.createObjectURL(compressedBlob);

          const img = new Image();
          img.src = compressedUrl;
          await new Promise(r => { img.onload = r; });

          const pw = doc.internal.pageSize.getWidth();
          const ph = doc.internal.pageSize.getHeight();
          const ratio = img.width / img.height;
          let fw, fh;
          if (ratio > pw / ph) { fw = pw; fh = pw / ratio; }
          else { fh = ph; fw = ph * ratio; }

          if (i > 0) doc.addPage();
          doc.addImage(img, 'JPEG', (pw - fw) / 2, (ph - fh) / 2, fw, fh);
          
          URL.revokeObjectURL(compressedUrl);
        }

        pdfBlob = doc.output('blob');
        console.log(`Generated PDF Size: ${(pdfBlob.size / 1024 / 1024).toFixed(2)} MB`);

        if (pdfBlob.size <= targetMax || levelIndex === qualityLevels.length - 1) {
          // If it fits, or if this is the maximum possible compression we can do, stop the loop
          break;
        }
      }

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
      {flash && <div className="absolute inset-0 bg-white z-50 pointer-events-none" style={{ opacity: 0.7 }} />}

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoCallbackRef}
          autoPlay
          playsInline
          muted
          onCanPlay={() => setVideoReady(true)}
          className="w-full h-full object-cover"
        />

        {!videoReady && (
          <div className="absolute inset-0 bg-black flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-white text-xs font-semibold tracking-wider">Starting camera...</p>
          </div>
        )}

        {hasTorch && videoReady && (
          <button 
            type="button" onClick={toggleTorch}
            className="absolute right-4 w-10 h-10 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20 z-40"
            style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            {torchOn ? <Zap size={20} className="text-yellow-400" fill="currentColor" /> : <ZapOff size={20} />}
          </button>
        )}

      </div>

      <div 
        className="bg-black flex items-center justify-around px-6 border-t border-white/10"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))', paddingTop: '1.5rem', height: 'auto', minHeight: '8rem' }}
      >
        <button
          onClick={onClose}
          className="text-white/70 text-sm font-bold px-3 py-2 rounded-xl hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>

        <button
          onClick={capturePhoto}
          disabled={!videoReady}
          className="w-20 h-20 rounded-full border-4 border-white p-1.5 active:scale-95 transition-transform disabled:opacity-50 disabled:scale-100"
        >
          <div className="w-full h-full bg-white rounded-full flex items-center justify-center shadow-lg">
            {videoReady
              ? <Scan className="text-black w-8 h-8" />
              : <div className="w-6 h-6 border-4 border-gray-300 border-t-gray-600 rounded-full animate-spin" />}
          </div>
        </button>

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
            <div className="w-full h-full"></div>
          )}
        </button>
      </div>
    </div>
  );

  // ── RENDER: Crop ────────────────────────────────────────────────────────────
  const renderCrop = () => {
    if (!currentOriginal) return null;
    const { width: iw, height: ih } = currentOriginal;

    return (
      <div className="h-full flex flex-col bg-gray-950">
        <div 
          className="flex items-center justify-between px-5 pb-3 bg-gray-900 border-b border-white/10 flex-shrink-0"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">✂️ Adjust Crop</span>
              {autoDetected && (
                <span className={clsx(
                  "flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse",
                  autoDetected === 'high'
                    ? "bg-green-500/20 border border-green-400/40 text-green-300"
                    : "bg-amber-500/20 border border-amber-400/40 text-amber-300"
                )}>
                  <span className={clsx("w-1.5 h-1.5 rounded-full", autoDetected === 'high' ? "bg-green-400" : "bg-amber-400")}></span>
                  {autoDetected === 'high' ? 'Auto Detected' : 'Auto Detected — Adjust'}
                </span>
              )}
            </div>
            <span className="text-[10px] text-gray-400">
              {autoDetected === 'high' ? 'Document found — drag corners to refine' 
               : autoDetected ? 'Edges detected — verify and adjust corners if needed'
               : 'Drag corners to select document area'}
            </span>
          </div>
          <div className="w-8" />
        </div>

        {magnifier && cropContainerRef.current && (
          <div
            className="fixed pointer-events-none w-24 h-24 rounded-full border-4 border-white shadow-2xl z-50 overflow-hidden bg-gray-900"
            style={{ left: magnifier.x - 48, top: magnifier.y - 120 }}
          >
            <img
              src={currentOriginal.url}
              className="absolute max-w-none"
              style={{
                width: cropContainerRef.current.offsetWidth * 2,
                height: cropContainerRef.current.offsetHeight * 2,
                left: -((magnifier.ptX / currentOriginal.width) * cropContainerRef.current.offsetWidth * 2) + 48,
                top: -((magnifier.ptY / currentOriginal.height) * cropContainerRef.current.offsetHeight * 2) + 48,
              }}
              alt="magnifier"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1 h-1 bg-blue-500 rounded-full" />
              <div className="w-full h-[1px] bg-blue-500/50 absolute" />
              <div className="h-full w-[1px] bg-blue-500/50 absolute" />
            </div>
          </div>
        )}

        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden p-6 sm:p-8">
          <div
            ref={cropContainerRef}
            className="relative select-none flex-shrink-0"
            style={{ 
              width: iw >= ih ? '100%' : 'auto',
              height: ih > iw ? '100%' : 'auto',
              maxHeight: '100%', 
              maxWidth: '100%', 
              aspectRatio: `${iw}/${ih}`, 
              cursor: 'crosshair',
              margin: 'auto'
            }}
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

            {/* Crop overlay SVG */}
            {points.length === 4 && (
              <svg
                className="absolute inset-0 w-full h-full overflow-visible"
                viewBox={`0 0 ${iw} ${ih}`}
                preserveAspectRatio="none"
              >
                {/* Dark mask outside crop area */}
                <defs>
                  <mask id="cropMask">
                    <rect width={iw} height={ih} fill="white" />
                    <polygon
                      points={points.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width={iw} height={ih} fill="rgba(0,0,0,0.5)" mask="url(#cropMask)" />

                {/* Crop border polygon */}
                <polygon
                  points={points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(59,130,246,0.08)"
                  stroke="#60a5fa"
                  strokeWidth={2 * (iw / 400)}
                />

                {/* Dashed edge lines */}
                {points.map((p, i) => {
                  const next = points[(i + 1) % 4];
                  return (
                    <line
                      key={`line-${i}`}
                      x1={p.x} y1={p.y}
                      x2={next.x} y2={next.y}
                      stroke="#93c5fd"
                      strokeWidth={1.5 * (iw / 400)}
                      strokeDasharray={`${6 * (iw / 400)} ${3 * (iw / 400)}`}
                    />
                  );
                })}

                {/* Corner drag handles */}
                {points.map((p, i) => (
                  <g key={`handle-${i}`}>
                    {/* Large invisible hit area */}
                    <circle
                      cx={p.x} cy={p.y}
                      r={22 * (iw / 400)}
                      fill="transparent"
                      style={{ cursor: 'move', pointerEvents: 'all' }}
                      onMouseDown={e => onMouseDown(e, i)}
                      onTouchStart={e => onTouchStart(e, i)}
                    />
                    {/* Outer white ring */}
                    <circle
                      cx={p.x} cy={p.y}
                      r={11 * (iw / 400)}
                      fill="white"
                      stroke="#3b82f6"
                      strokeWidth={3 * (iw / 400)}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Inner blue dot */}
                    <circle
                      cx={p.x} cy={p.y}
                      r={5 * (iw / 400)}
                      fill="#3b82f6"
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                ))}
                
                {/* Edge drag handles (Left, Right, Top, and Bottom) */}
                {[
                  {id: 'left', p1: 3, p2: 0}, 
                  {id: 'right', p1: 1, p2: 2},
                  {id: 'top', p1: 0, p2: 1},
                  {id: 'bottom', p1: 2, p2: 3}
                ].map(edge => {
                  const p1 = points[edge.p1];
                  const p2 = points[edge.p2];
                  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                  return (
                    <g key={`handle-${edge.id}`}>
                      <circle
                        cx={mid.x} cy={mid.y}
                        r={22 * (iw / 400)}
                        fill="transparent"
                        style={{ cursor: 'move', pointerEvents: 'all' }}
                        onMouseDown={e => onMouseDown(e, edge.id)}
                        onTouchStart={e => onTouchStart(e, edge.id)}
                      />
                      <circle
                        cx={mid.x} cy={mid.y}
                        r={11 * (iw / 400)}
                        fill="white"
                        stroke="#f59e0b"
                        strokeWidth={3 * (iw / 400)}
                        style={{ pointerEvents: 'none' }}
                      />
                      <circle
                        cx={mid.x} cy={mid.y}
                        r={5 * (iw / 400)}
                        fill="#f59e0b"
                        style={{ pointerEvents: 'none' }}
                      />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        <div 
          className="bg-gray-900 border-t border-white/10 flex items-center justify-between px-6 flex-shrink-0"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', paddingTop: '1rem', height: 'auto', minHeight: '6rem' }}
        >

          <div className="flex w-full items-center justify-between">
            <button
              onClick={() => { setAutoDetected(false); setStep('camera'); }}
              className="flex items-center gap-2 text-white/60 font-bold text-sm hover:text-white transition-colors"
            >
              <RotateCw size={16} /> Retake
            </button>
            <Button onClick={handleCropComplete} loading={isProcessing}>
              <Check size={18} className="mr-2" /> Confirm Page
            </Button>
          </div>
        </div>


      </div>
    );
  };

  // ── RENDER: Review ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPages((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
    setActiveId(null);
  };

  const activePage = activeId ? pages.find(p => p.id === activeId) : null;

  const renderReview = () => (
    <div className="h-full flex flex-col bg-gray-50">
      <div 
        className="px-5 pb-4 bg-white border-b flex items-center justify-between shadow-sm flex-shrink-0"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
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

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <FileText size={48} className="opacity-30" />
            <p className="text-sm font-medium">No pages scanned yet</p>
          </div>
        ) : (
          <DndContext 
            sensors={sensors} 
            collisionDetection={closestCenter} 
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={pages.map(p => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-4 m-0 p-0 list-none px-1">
                {pages.map((page, index) => (
                  <SortablePage 
                    key={page.id} 
                    page={page} 
                    index={index} 
                    onPreview={setPreviewPage} 
                    onDelete={deletePage} 
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay zIndex={99999}>
              {activeId && activePage ? (
                <div className="relative w-full h-full flex-shrink-0 cursor-grabbing shadow-2xl scale-105 opacity-100">
                  <div className="w-full h-full bg-gray-100 rounded-xl overflow-hidden border-2 border-blue-500">
                    <img src={activePage.preview} className="w-full h-full object-cover" alt="Dragging" />
                    <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                      {pages.findIndex(p => p.id === activeId) + 1}
                    </div>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <div 
        className="p-4 bg-white border-t flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          onClick={() => {
            if (pages.length >= 20) {
              toast.error('Maximum 20 pages allowed per scan');
            } else {
              setStep('camera');
            }
          }}
          className="w-full py-3.5 border-2 border-dashed border-blue-200 bg-blue-50/50 rounded-2xl text-blue-600 text-sm font-bold flex items-center justify-center gap-2 active:bg-blue-100 transition-colors"
        >
          <Camera size={18} /> Add Another Page
        </button>
        <Button
          onClick={finishScan}
          loading={isProcessing}
          disabled={pages.length === 0}
          className="w-full py-4 rounded-2xl"
        >
          Generate PDF &amp; Upload <ArrowRight size={18} className="ml-2" />
        </Button>
      </div>

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

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col overflow-hidden touch-none">
      {step === 'camera' && renderCamera()}
      {step === 'crop'   && renderCrop()}
      {step === 'review' && renderReview()}
    </div>,
    document.body
  );
}
