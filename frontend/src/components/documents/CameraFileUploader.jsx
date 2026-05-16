import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDropzone } from 'react-dropzone';
import imageCompression from 'browser-image-compression';
import { Upload, Camera, X, CheckCircle, FileText as FilePdf, ZoomIn, Scan } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Button } from '../common';
import DocumentScanner from './DocumentScanner';

/**
 * CameraFileUploader
 *
 * Props:
 *   files    : array of { file, preview, type } — controlled list
 *   onChange : (newFilesArray) => void
 *   disabled : bool
 *   single   : bool — if true, behaves as single-file (replaces instead of adding)
 *              defaults to false (multi-photo mode)
 */
export default function CameraFileUploader({ file, files: filesProp, onChange, disabled, single = false }) {
  // Support both old single-file API (file prop) and new multi-file API (files prop)
  const isLegacySingle = file !== undefined;
  const files = isLegacySingle ? (file ? [file] : []) : (filesProp || []);

  const handleChange = (newFiles) => {
    if (isLegacySingle || single) {
      // Legacy: pass single file object or null
      onChange(newFiles.length > 0 ? newFiles[newFiles.length - 1] : null);
    } else {
      onChange(newFiles);
    }
  };

  const [mode, setMode] = useState('grid'); // 'grid' | 'camera'
  const [compressing, setCompressing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [stagedPhoto, setStagedPhoto] = useState(null);
  const [gpsData, setGpsData] = useState(null);
  const [address, setAddress] = useState(null);
  const [fetchingGps, setFetchingGps] = useState(false);
  const [liveTime, setLiveTime] = useState(new Date());
  const [watchId, setWatchId] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // True when viewport is mobile/tablet (< 1024px = below lg breakpoint)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const streamRef = useRef(null);

  const formatBytes = (b) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Ref callback — assigns srcObject immediately when <video> mounts
  const videoRefCallback = useCallback((videoEl) => {
    if (!videoEl) return;
    if (streamRef.current) {
      videoEl.srcObject = streamRef.current;
      videoEl.play().catch(() => {});
    }
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
    setVideoReady(false);
    setMode('grid');
  };

  const startCamera = async () => {
    setVideoReady(false);
    try {
      // Try with environment camera and specific resolution, fall back to any camera
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      };
      
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Only fallback if it's a constraint error, not a permission error
        if (err.name === 'OverconstrainedError') {
          mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw err;
        }
      }
      
      streamRef.current = mediaStream;
      setMode('camera');

      // Start GPS tracking for live overlay
      const id = navigator.geolocation.watchPosition(
        async (pos) => {
          setGpsData(pos.coords);
          // Only fetch address if significantly moved or first time
          if (!address) {
            try {
              const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
              const data = await res.json();
              setAddress(data.display_name);
            } catch (e) { console.error("Geocoding error", e); }
          }
        },
        () => setGpsData(null),
        { enableHighAccuracy: true }
      );
      setWatchId(id);

      // Start time ticker
      const timer = setInterval(() => setLiveTime(new Date()), 1000);
      return () => clearInterval(timer);
    } catch (err) {
      console.error('Camera error:', err);
      toast.error('Could not access camera. Please allow camera permission.');
    }
  };

  const capturePhoto = async () => {
    if (capturing || compressing) return;
    const videoEl = document.getElementById('jphrc-cfu-video');
    if (!videoEl) { toast.error('Camera not ready'); return; }
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      toast.error('Camera still loading — please wait'); return;
    }

    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0);

      // 1. Fetch Static Map (Optional but recommended for the look)
      let mapImg = null;
      if (gpsData) {
        try {
          const mapUrl = `https://static-maps.yandex.ru/1.x/?ll=${gpsData.longitude},${gpsData.latitude}&z=14&l=map&size=200,200`;
          mapImg = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = mapUrl;
          });
        } catch (e) { console.error("Map fetch failed", e); }
      }

      // 2. Draw sophisticated GPS Tag Overlay
      const scale = canvas.width / 1000;
      const cardHeight = 240 * scale; 
      const cardPadding = 20 * scale;
      
      // Draw background card (semi-transparent dark)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(0, canvas.height - cardHeight, canvas.width, cardHeight);

      let textX = cardPadding;
      
      // Draw Mini Map if available
      if (mapImg) {
        const mapSize = cardHeight - (cardPadding * 2);
        const mapY = canvas.height - cardHeight + cardPadding;
        
        ctx.drawImage(mapImg, cardPadding, mapY, mapSize, mapSize);
        
        // Map border
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2 * scale;
        ctx.strokeRect(cardPadding, mapY, mapSize, mapSize);

        // Map center crosshair dot
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(cardPadding + mapSize/2, mapY + mapSize/2, 6 * scale, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();

        textX = cardPadding + mapSize + (cardPadding);
      }

      const now = liveTime;
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      
      // Text drawing
      ctx.fillStyle = 'white';
      
      // Line 0: Header Badge with Pin Icon
      ctx.font = `bold ${16 * scale}px Inter, sans-serif`;
      ctx.fillStyle = '#60a5fa'; // blue-400
      ctx.fillText("📍 GPS PHOTO TAG", textX, canvas.height - cardHeight + cardPadding + (10 * scale));

      // Line 1: Location Title (City, State)
      ctx.fillStyle = 'white';
      const addressParts = address ? address.split(',').map(s => s.trim()) : [];
      const cityState = addressParts.length > 2 ? `${addressParts[1]}, ${addressParts[2]}` : 'Locating...';
      ctx.font = `bold ${32 * scale}px Inter, sans-serif`;
      ctx.fillText(cityState, textX, canvas.height - cardHeight + cardPadding + (45 * scale));

      // Line 2: Full Address (Smaller, Multi-line if needed)
      ctx.font = `${18 * scale}px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const fullAddress = address || 'Fetching full address details...';
      const addressWords = fullAddress.split(' ');
      let line = '';
      let currentY = canvas.height - cardHeight + cardPadding + (75 * scale);
      
      for (let n = 0; n < addressWords.length; n++) {
        const testLine = line + addressWords[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > (canvas.width - textX - cardPadding) && n > 0) {
          ctx.fillText(line, textX, currentY);
          line = addressWords[n] + ' ';
          currentY += 22 * scale;
        } else {
          line = testLine;
        }
        if (currentY > canvas.height - 80 * scale) break; // Don't overlap bottom info
      }
      ctx.fillText(line, textX, currentY);

      // Line 3: Lat/Long Info
      ctx.fillStyle = '#fcd34d'; // amber-300
      ctx.font = `bold ${20 * scale}px Roboto Mono, monospace`;
      const latStr = gpsData ? gpsData.latitude.toFixed(6) : '--.------';
      const lonStr = gpsData ? gpsData.longitude.toFixed(6) : '--.------';
      const coordStr = `LAT: ${latStr}°  |  LONG: ${lonStr}°`;
      ctx.fillText(coordStr, textX, canvas.height - 45 * scale);
      
      // Line 4: Hospital Name & Time
      ctx.fillStyle = 'white';
      ctx.font = `bold ${16 * scale}px Inter, sans-serif`;
      ctx.fillText("JPHRC JAI PRAKASH HOSPITAL", textX, canvas.height - 20 * scale);
      
      ctx.textAlign = 'right';
      ctx.font = `italic ${14 * scale}px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${dateStr} • ${timeStr}`, canvas.width - cardPadding, canvas.height - 20 * scale);
      ctx.textAlign = 'left'; // reset

      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Empty blob')), 'image/jpeg', 0.90)
      );

      const rawFile = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });

      setCompressing(true);
      const compressed = await imageCompression(rawFile, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
      const newEntry = { file: compressed, preview: URL.createObjectURL(compressed), type: 'image' };

      setStagedPhoto(newEntry);
      setCompressing(false);
      setCapturing(false);
    } catch (err) {
      console.error('Capture error:', err);
      toast.error('Capture failed — please try again');
    } finally {
      setCapturing(false);
      setCompressing(false);
    }
  };

  const removeFile = (index) => {
    URL.revokeObjectURL(files[index].preview);
    handleChange(files.filter((_, i) => i !== index));
  };

  const processAndSetFile = async (f) => {
    if (f.type.startsWith('image/')) {
      setCompressing(true);
      try {
        const compressed = await imageCompression(f, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
        const entry = { file: compressed, preview: URL.createObjectURL(compressed), type: 'image' };
        if (isLegacySingle || single) {
          handleChange([entry]);
        } else {
          handleChange([...files, entry]);
        }
      } catch { toast.error('Compression failed'); }
      finally { setCompressing(false); }
    } else if (f.type === 'application/pdf') {
      if (f.size > 1 * 1024 * 1024) { toast.error('PDF must be under 1MB'); return; }
      const entry = { file: f, preview: null, type: 'pdf' };
      if (isLegacySingle || single) {
        handleChange([entry]);
      } else {
        handleChange([...files, entry]);
      }
    } else {
      toast.error('Unsupported file type');
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    for (const f of acceptedFiles) await processAndSetFile(f);
  }, [files]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/*': [], 'application/pdf': [] },
    maxFiles: (isLegacySingle || single) ? 1 : 10,
    disabled: disabled || compressing || mode === 'camera',
    noClick: true, // Trigger manually via dedicated button
  });

  // ── Camera View (Rendered via Portal for true full-screen) ──────────────────
  if (mode === 'camera') {
    if (stagedPhoto) {
      return createPortal(
        <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col h-[100dvh] w-full overflow-hidden touch-none">
          <div className="flex-1 relative bg-black flex items-center justify-center">
            <img src={stagedPhoto.preview} alt="Captured preview" className="w-full h-full object-contain" />
          </div>
          <div className="h-28 bg-gray-900 border-t border-white/10 flex items-center justify-around px-4">
            <button
              onClick={() => setStagedPhoto(null)}
              className="text-white/70 font-bold px-6 py-3 rounded-xl hover:bg-white/10 transition-colors"
            >
              Retake
            </button>
            <Button
              className="px-8 py-3 rounded-xl shadow-lg"
              onClick={() => {
                if (isLegacySingle || single) {
                  handleChange([stagedPhoto]);
                  stopCamera();
                } else {
                  const updated = [...files, stagedPhoto];
                  handleChange(updated);
                  setStagedPhoto(null);
                  toast.success(`Photo ${updated.length} captured! 📷`, { duration: 1200 });
                }
              }}
            >
              <CheckCircle size={20} className="mr-2" /> Done
            </Button>
          </div>
        </div>,
        document.body
      );
    }

    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col h-[100dvh] w-full overflow-hidden touch-none">
        {/* Video Preview */}
        <div className="relative flex-1 bg-black overflow-hidden">
          <video
            id="jphrc-cfu-video"
            ref={videoRefCallback}
            autoPlay playsInline muted
            onLoadedMetadata={(e) => { setVideoReady(true); e.target.play().catch(() => {}); }}
            className="w-full h-full object-cover"
          />

          {/* Loading State */}
          {!videoReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white bg-black">
              <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              <p className="text-sm font-medium tracking-wide">Initializing Camera...</p>
            </div>
          )}



          {/* GPS Live Tagging Overlay */}
          {videoReady && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black/80 to-transparent pt-16 text-white flex gap-3 items-end">
              {/* Live Map Box */}
              <div className="w-[84px] h-[84px] bg-gray-900 rounded border border-white/40 flex-shrink-0 relative overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.8)]">
                {gpsData ? (
                  <img 
                    src={`https://static-maps.yandex.ru/1.x/?ll=${gpsData.longitude},${gpsData.latitude}&z=15&l=map&size=100,100`}
                    className="w-full h-full object-cover opacity-90 contrast-125 saturate-50"
                    alt="map"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900/80">
                    <Scan className="w-5 h-5 text-blue-500 animate-pulse mb-1" />
                    <span className="text-[8px] font-bold text-gray-400 tracking-wider">LOCATING</span>
                  </div>
                )}
                {gpsData && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6] border border-white animate-pulse" />
                  </div>
                )}
                {/* Crosshair corners */}
                <div className="absolute top-0 left-0 w-2 h-2 border-t-[1.5px] border-l-[1.5px] border-blue-400" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b-[1.5px] border-r-[1.5px] border-blue-400" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-end">
                <div className="flex items-center gap-1.5 mb-1">
                   <span className="bg-blue-600 text-white text-[8px] px-1.5 py-0.5 rounded-sm font-black tracking-wider shadow-sm">GEO-TAG</span>
                   <span className="text-[9px] font-black tracking-widest text-amber-400 uppercase drop-shadow-md">JPHRC Hospital</span>
                </div>
                <div className="font-black text-[15px] truncate drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] text-white">
                  {address ? address.split(',').slice(0, 2).join(', ') : 'Determining location...'} 🇮🇳
                </div>
                <div className="text-[10px] text-white/80 line-clamp-1 leading-snug drop-shadow-md font-medium">
                  {address ? address.split(',').slice(2).join(', ').trim() : 'Fetching address details...'}
                </div>
                
                <div className="flex flex-col mt-1.5 bg-black/50 p-1.5 px-2 rounded border border-white/10 backdrop-blur-md w-fit">
                  <div className="flex gap-3 text-[10px] font-mono font-bold text-blue-300 tracking-tight">
                    <span>LAT {gpsData ? gpsData.latitude.toFixed(6) : '--.------'}°</span>
                    <span>LNG {gpsData ? gpsData.longitude.toFixed(6) : '--.------'}°</span>
                  </div>
                  <div className="text-[9px] font-bold text-gray-300 mt-0.5 uppercase tracking-wider">
                    {liveTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} • {liveTime.toLocaleTimeString('en-US', { hour12: false })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Indicators */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            {(capturing || compressing) && (
              <div className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full flex items-center gap-2 shadow-xl animate-pulse">
                <div className="w-2 h-2 bg-white rounded-full animate-ping" />
                {compressing ? 'TAGGING & SAVING...' : 'CAPTURING...'}
              </div>
            )}
            {!(isLegacySingle || single) && files.length > 0 && (
              <div className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1.5 rounded-full w-fit border border-white/20">
                {files.length} PHOTOS CAPTURED
              </div>
            )}
          </div>

          {/* Close Button */}
          <button 
            type="button" onClick={stopCamera}
            className="absolute top-4 right-4 w-10 h-10 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20"
          >
            <X size={20} />
          </button>
        </div>

        {/* Shutter Controls */}
        <div className="h-32 bg-black flex items-center justify-around px-8 border-t border-white/5">
          {/* Done/Cancel Button */}
          <button 
            type="button" onClick={stopCamera} disabled={capturing || compressing}
            className="text-white/70 text-sm font-semibold hover:text-white transition-colors"
          >
            {(isLegacySingle || single) ? 'Cancel' : 'Done'}
          </button>

          {/* Shutter Button */}
          <button
            type="button" 
            onClick={capturePhoto}
            disabled={capturing || compressing || !videoReady}
            className="group relative flex items-center justify-center"
          >
            <div className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-90">
              <div className={clsx(
                "w-16 h-16 rounded-full transition-all",
                (capturing || compressing) ? "bg-gray-500 scale-75" : "bg-white scale-100"
              )} />
            </div>
            {(capturing || compressing) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </button>

          {/* Placeholder for symmetry */}
          <div className="w-12" />
        </div>
      </div>,
      document.body
    );
  }

  // ── Single-file legacy mode: show preview if file set ───────────────────────
  if ((isLegacySingle || single) && files.length > 0) {
    const f = files[0];
    return (
      <div className="border-2 border-dashed border-green-200 bg-green-50 rounded-xl p-6 text-center">
        <div className="space-y-2">
          {f.type === 'image' ? (
            <img src={f.preview} alt="Preview" className="w-24 h-24 object-cover rounded-lg mx-auto border border-green-200 shadow-sm" />
          ) : (
            <div className="w-16 h-16 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <FilePdf className="w-8 h-8 text-red-500" />
            </div>
          )}
          <p className="text-sm font-semibold text-gray-800 pt-2">{f.file.name}</p>
          <p className="text-xs text-gray-500">{formatBytes(f.file.size)}</p>
          <div className="flex items-center justify-center gap-1 text-green-600 font-medium">
            <CheckCircle size={14} /><span className="text-xs">Ready to upload</span>
          </div>
          {!disabled && (
            <button type="button" onClick={() => removeFile(0)}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto mt-2 bg-white px-2 py-1 rounded-md border border-red-100">
              <X size={12} /> Remove file
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Multi-file grid mode ─────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Photo grid — shown when at least 1 photo captured */}
      {files.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Captured Photos
            </p>
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg">
              {files.length} photo{files.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative group cursor-pointer" onClick={() => setPreviewPhoto(f)}>
                {f.type === 'image' ? (
                  <img src={f.preview} alt={`Photo ${i + 1}`}
                    className="w-16 h-16 object-cover rounded-xl border-2 border-white shadow-md group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-16 h-16 bg-red-50 rounded-xl border-2 border-white shadow-md flex items-center justify-center">
                    <FilePdf size={22} className="text-red-400" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <ZoomIn size={12} className="text-white opacity-0 group-hover:opacity-100" />
                </div>
                <span className="absolute bottom-0.5 left-0.5 bg-black/50 text-white text-[8px] font-bold px-1 rounded">
                  {i + 1}
                </span>
                {!disabled && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center shadow hover:bg-red-600">
                    <X size={8} />
                  </button>
                )}
              </div>
            ))}


          </div>
        </div>
      )}

      {/* Compact Action Area: Camera vs Gallery vs Scanner */}
      <div className={clsx("gap-2 mb-3", isMobile ? "grid grid-cols-3" : "flex")}>
        {/* Option 1: Internal GPS Camera - Mobile / Tablet only */}
        {isMobile && (
          <button
            type="button"
            onClick={startCamera}
            disabled={disabled || compressing}
            className={clsx(
              "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
              "border-blue-100 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-300 group",
              (disabled || compressing) && "opacity-60 cursor-not-allowed"
            )}
          >
            <div className="relative w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
              <Camera className="w-5 h-5 text-blue-600" />
              <div className="absolute -top-1 -right-1 bg-blue-600 text-[7px] text-white font-black px-1 rounded-sm border border-white">
                GPS
              </div>
            </div>
            <p className="text-[10px] font-bold text-gray-800">GPS Camera</p>
          </button>
        )}

        {/* Option 2: System File Picker - Always visible */}
        <div
          {...getRootProps()}
          onClick={open}
          className={clsx(
            "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 border-dashed transition-all cursor-pointer",
            isMobile ? "" : "flex-1",
            isDragActive ? "border-green-400 bg-green-50" : "border-gray-200 bg-gray-50/30 hover:border-gray-300 hover:bg-gray-50",
            (disabled || compressing) && "opacity-60 cursor-not-allowed pointer-events-none"
          )}
        >
          <input {...getInputProps()} />
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mb-1">
            <Upload className="w-5 h-5 text-gray-500" />
          </div>
          <p className="text-[10px] font-bold text-gray-700">Gallery / PDF</p>
        </div>

        {/* Option 3: Document Scanner - Mobile / Tablet only */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            disabled={disabled || compressing}
            className={clsx(
              "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
              "border-purple-100 bg-purple-50/50 hover:bg-purple-50 hover:border-purple-300 group",
              (disabled || compressing) && "opacity-60 cursor-not-allowed"
            )}
          >
            <div className="relative w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
              <Scan className="w-5 h-5 text-purple-600" />
              <div className="absolute -top-1 -right-1 bg-purple-600 text-[7px] text-white font-black px-1 rounded-sm border border-white">
                SCAN
              </div>
            </div>
            <p className="text-[10px] font-bold text-gray-800">Scanner</p>
          </button>
        )}
      </div>

      {isMobile && (
        <div className="bg-amber-50/50 border border-amber-100/50 rounded-lg p-2.5">
          <p className="text-[10px] text-amber-700 leading-tight">
            <span className="font-bold uppercase tracking-tight">Recommendation:</span> Use the <span className="font-bold underline">GPS Camera</span> for automatic branding and verification.
          </p>
        </div>
      )}





      {/* Full-screen preview */}
      {previewPhoto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewPhoto(null)}>
          <button className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full"
            onClick={() => setPreviewPhoto(null)}><X size={20} /></button>
          <img src={previewPhoto.preview} alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Document Scanner Component — only available on mobile/tablet */}
      {scannerOpen && isMobile && (
        <DocumentScanner 
          onClose={() => setScannerOpen(false)} 
          onComplete={(pdfFile) => processAndSetFile(pdfFile)} 
        />
      )}
    </div>
  );
}
