import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDropzone } from 'react-dropzone';
import imageCompression from 'browser-image-compression';
import { Upload, Camera, X, CheckCircle, FileText as FilePdf, ZoomIn } from 'lucide-react';
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
  const [gpsData, setGpsData] = useState(null);
  const [address, setAddress] = useState(null);
  const [fetchingGps, setFetchingGps] = useState(false);
  const [liveTime, setLiveTime] = useState(new Date());
  const [watchId, setWatchId] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

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
      const cardHeight = 220 * scale; // Increased for more data
      const cardPadding = 15 * scale;
      
      // Draw background card (semi-transparent dark)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, canvas.height - cardHeight, canvas.width, cardHeight);

      let textX = cardPadding;
      
      // Draw Mini Map if available
      if (mapImg) {
        const mapSize = cardHeight - (cardPadding * 2);
        ctx.drawImage(mapImg, cardPadding, canvas.height - cardHeight + cardPadding, mapSize, mapSize);
        textX = cardPadding + mapSize + (cardPadding);
      }

      const now = liveTime;
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const tzOffset = `GMT ${now.getTimezoneOffset() <= 0 ? '+' : '-'}${Math.abs(Math.floor(now.getTimezoneOffset() / 60)).toString().padStart(2, '0')}:${Math.abs(now.getTimezoneOffset() % 60).toString().padStart(2, '0')}`;

      // Text drawing
      ctx.fillStyle = 'white';
      
      // Line 0: Header Badge
      ctx.font = `bold ${14 * scale}px Inter, sans-serif`;
      ctx.fillStyle = '#3b82f6'; // blue-500
      ctx.fillText("GPS CAMERA | GEO-TAGGING", textX, canvas.height - cardHeight + cardPadding + (10 * scale));

      // Line 1: Location Title (City, State, Country)
      ctx.fillStyle = 'white';
      const locationTitle = address ? address.split(',').slice(0, 3).join(',') : 'Location Tagging...';
      ctx.font = `bold ${26 * scale}px Inter, sans-serif`;
      ctx.fillText(locationTitle + " 🇮🇳", textX, canvas.height - cardHeight + cardPadding + (40 * scale));

      // Line 2: Full Address (Smaller)
      ctx.font = `${16 * scale}px Inter, sans-serif`;
      const addressLines = address ? address.split(',').slice(3).join(',').match(/.{1,65}/g) || [] : [];
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      let currentY = canvas.height - cardHeight + cardPadding + (65 * scale);
      addressLines.slice(0, 2).forEach(line => {
        ctx.fillText(line.trim(), textX, currentY);
        currentY += 20 * scale;
      });

      // Line 3: Lat/Long & Hospital
      ctx.fillStyle = 'white';
      ctx.font = `bold ${18 * scale}px Inter, sans-serif`;
      const locStr = gpsData 
        ? `Lat ${gpsData.latitude.toFixed(6)}° Long ${gpsData.longitude.toFixed(6)}°`
        : 'Lat -- Long --';
      ctx.fillText(locStr, textX, currentY + (10 * scale));
      
      ctx.font = `bold ${14 * scale}px Inter, sans-serif`;
      ctx.fillStyle = '#fbbf24'; // amber-400
      ctx.fillText("JPHRC ROURKELA HOSPITAL", textX, currentY + (28 * scale));

      // Line 4: DateTime
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `500 ${16 * scale}px Inter, sans-serif`;
      ctx.fillText(`${dateStr} ${timeStr} ${tzOffset}`, textX, currentY + (48 * scale));

      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Empty blob')), 'image/jpeg', 0.90)
      );

      const rawFile = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // In single mode, stop camera before compressing
      if (isLegacySingle || single) stopCamera();

      setCompressing(true);
      const compressed = await imageCompression(rawFile, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
      const newEntry = { file: compressed, preview: URL.createObjectURL(compressed), type: 'image' };

      if (isLegacySingle || single) {
        handleChange([newEntry]);
      } else {
        const updated = [...files, newEntry];
        handleChange(updated);
        toast.success(`Photo ${updated.length} captured! 📷`, { duration: 1200 });
      }
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
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/60 backdrop-blur-sm text-white flex gap-4 items-end border-t border-white/10">
              {/* Live Map Placeholder */}
              <div className="w-20 h-20 bg-gray-800 rounded-lg overflow-hidden flex-shrink-0 border border-white/20 relative">
                {gpsData ? (
                  <img 
                    src={`https://static-maps.yandex.ru/1.x/?ll=${gpsData.longitude},${gpsData.latitude}&z=14&l=map&size=100,100`}
                    className="w-full h-full object-cover"
                    alt="map"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,1)] animate-pulse" />
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-0.5 pb-1">
                <div className="flex items-center gap-2">
                   <span className="bg-blue-600 text-[8px] px-1 rounded font-bold">GEO-TAG</span>
                   <span className="text-[9px] font-bold text-amber-400">JPHRC HOSPITAL</span>
                </div>
                <p className="text-sm font-bold truncate">
                  {address ? address.split(',').slice(0, 2).join(', ') : 'Determining location...'} 🇮🇳
                </p>
                <p className="text-[10px] text-white/70 line-clamp-1 leading-tight">
                  {address ? address.split(',').slice(2).join(', ').trim() : 'Fetching address details...'}
                </p>
                <div className="pt-0.5 flex flex-col text-[10px] text-white/90 font-medium">
                  <span className="text-blue-300 font-bold">
                    {gpsData 
                      ? `Lat ${gpsData.latitude.toFixed(6)}° Long ${gpsData.longitude.toFixed(6)}°`
                      : 'GPS Signal: Searching...'}
                  </span>
                  <span className="text-[9px] opacity-80">{liveTime.toLocaleDateString('en-GB', { weekday: 'long' })}, {liveTime.toLocaleString()}</span>
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
      <div className="grid grid-cols-3 sm:grid-cols-1 gap-2 mb-3">
        {/* Option 1: Internal GPS Camera - Mobile Only */}
        <button
          type="button"
          onClick={startCamera}
          disabled={disabled || compressing}
          className={clsx(
            "sm:hidden flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
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

        {/* Option 2: System File Picker - Always visible */}
        <div
          {...getRootProps()}
          onClick={open}
          className={clsx(
            "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 border-dashed transition-all cursor-pointer",
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

        {/* Option 3: Document Scanner - Mobile Only */}
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={disabled || compressing}
          className={clsx(
            "sm:hidden flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
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
      </div>

      <div className="sm:hidden bg-amber-50/50 border border-amber-100/50 rounded-lg p-2.5">
        <p className="text-[10px] text-amber-700 leading-tight">
          <span className="font-bold uppercase tracking-tight">Recommendation:</span> Use the <span className="font-bold underline">GPS Camera</span> for automatic branding and verification.
        </p>
      </div>





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

      {/* Document Scanner Component */}
      {scannerOpen && (
        <DocumentScanner 
          onClose={() => setScannerOpen(false)} 
          onComplete={(pdfFile) => processAndSetFile(pdfFile)} 
        />
      )}
    </div>
  );
}
