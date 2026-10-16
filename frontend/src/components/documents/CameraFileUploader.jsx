import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDropzone } from 'react-dropzone';
import imageCompression from 'browser-image-compression';
import { Upload, Camera, X, CheckCircle, FileText as FilePdf, ZoomIn, Scan, Zap, ZapOff, Edit2, Layers } from 'lucide-react';
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
  const [gpsData, setGpsData] = useState({ latitude: 22.224743, longitude: 84.797015 });
  // Pre-load cached address from localStorage so GPS tag is immediate even offline
  const [address, setAddress] = useState("JPHRC, Dayanand Nagar, Dandiapali, Rourkela, Odisha 769004");
  const [addressCached, setAddressCached] = useState(true);
  const [fetchingGps, setFetchingGps] = useState(false);
  const [liveTime, setLiveTime] = useState(new Date());
  const [watchId, setWatchId] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false); // false, true, or { index, pages, name }
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [mapError, setMapError] = useState(false); // true when static map fails to load

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const effectiveGpsData = { latitude: 22.224743, longitude: 84.797015 };

  // True when viewport is mobile/tablet (< 1024px = below lg breakpoint)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const formatBytes = (b) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Ref callback — assigns srcObject immediately when <video> mounts
  const videoRefCallback = useCallback((videoEl) => {
    if (!videoEl) return;
    if (streamRef.current) {
      videoEl.srcObject = streamRef.current;
      videoEl.play().catch(() => { });
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
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setVideoReady(false);
    setMode('grid');
  };

  const startCamera = async () => {
    setVideoReady(false);
    try {
      // High-resolution camera request (1080p Full HD ideal, up to 2K capable)
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
        },
        audio: false,
      };

      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback to standard resolution if high constraints fail on older devices
        if (err.name === 'OverconstrainedError') {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          });
        } else {
          throw err;
        }
      }

      streamRef.current = mediaStream;
      setMode('camera');

      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = track.getCapabilities ? track.getCapabilities() : {};
          if (capabilities.torch) {
            setHasTorch(true);
          }
          // Request continuous focus and auto exposure if supported for sharper captures
          const advanced = [];
          if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            advanced.push({ focusMode: 'continuous' });
          }
          if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
            advanced.push({ exposureMode: 'continuous' });
          }
          if (advanced.length > 0) {
            await track.applyConstraints({ advanced }).catch(() => {});
          }
        } catch (e) {
          // getCapabilities might not be supported
        }
      }

      // Start GPS tracking for live overlay
      const id = navigator.geolocation.watchPosition(
        async (pos) => {
          // Hardcoded GPS data and address as requested
          setGpsData({ latitude: 22.224743, longitude: 84.797015 });
          
          try {
            localStorage.setItem('gps_last_coords', JSON.stringify({
              lat: 22.224743,
              lng: 84.797015,
            }));
          } catch { }
          
          setAddress("JPHRC, Dayanand Nagar, Dandiapali, Rourkela, Odisha 769004");
          setAddressCached(true);
        },
        () => setGpsData({ latitude: 22.224743, longitude: 84.797015 }),
        { enableHighAccuracy: true }
      );
      setWatchId(id);

      // Reset map error state when camera starts fresh
      setMapError(false);

      // Start time ticker
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setLiveTime(new Date()), 1000);
    } catch (err) {
      console.error('Camera error:', err);
      toast.error('Could not access camera. Please allow camera permission.');
    }
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
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(videoEl, 0, 0);

      // Orientation-independent scale factor based on minimum dimension
      // This guarantees text remains large and clear in both Portrait & Landscape
      const minDim = Math.min(canvas.width, canvas.height);
      const scale = Math.max(minDim / 700, 1.25);

      const cardPadding = Math.round(24 * scale);
      const cardHeight = Math.round(290 * scale);

      // High-opacity dark card background for optimal contrast against bright documents/backgrounds
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillRect(0, canvas.height - cardHeight, canvas.width, cardHeight);

      // Top accent bar: vibrant medical blue
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(0, canvas.height - cardHeight, canvas.width, Math.max(3, Math.round(3.5 * scale)));

      const textX = cardPadding;
      const cardTop = canvas.height - cardHeight;

      const now = liveTime;
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

      const fontSans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      const fontMono = "'Roboto Mono', 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace";

      // Line 0: Header Badge with Pin Icon
      ctx.font = `bold ${Math.round(18 * scale)}px ${fontSans}`;
      ctx.fillStyle = '#60a5fa'; // blue-400
      ctx.fillText("📍 GPS VERIFIED PHOTO", textX, cardTop + cardPadding + Math.round(14 * scale));

      // Line 1: Location Title (City, State / Landmark)
      ctx.fillStyle = '#ffffff';
      const cityState = "JPHRC, Dayanand Nagar";
      ctx.font = `bold ${Math.round(36 * scale)}px ${fontSans}`;
      ctx.fillText(cityState, textX, cardTop + cardPadding + Math.round(52 * scale));

      // Line 2: Full Address (Prominent, clean wrap)
      ctx.font = `500 ${Math.round(20 * scale)}px ${fontSans}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      const fullAddress = "JPHRC, Dayanand Nagar, Dandiapali, Rourkela, Odisha 769004";
      const addressWords = fullAddress.split(' ');
      let line = '';
      let currentY = cardTop + cardPadding + Math.round(82 * scale);
      const maxAddressWidth = canvas.width - (cardPadding * 2);

      for (let n = 0; n < addressWords.length; n++) {
        const testLine = line + addressWords[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxAddressWidth && n > 0) {
          ctx.fillText(line.trim(), textX, currentY);
          line = addressWords[n] + ' ';
          currentY += Math.round(25 * scale);
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), textX, currentY);

      // Line 3: Lat/Long Info (High-visibility monospaced Amber coordinates)
      ctx.fillStyle = '#fde047'; // amber-300
      ctx.font = `bold ${Math.round(24 * scale)}px ${fontMono}`;
      const latStr = effectiveGpsData ? effectiveGpsData.latitude.toFixed(6) : '--.------';
      const lonStr = effectiveGpsData ? effectiveGpsData.longitude.toFixed(6) : '--.------';
      const coordStr = `LAT: ${latStr}°   |   LONG: ${lonStr}°`;
      ctx.fillText(coordStr, textX, canvas.height - Math.round(48 * scale));

      // Line 4: Hospital Name & Time (Bottom row)
      ctx.fillStyle = '#93c5fd';
      ctx.font = `bold ${Math.round(17 * scale)}px ${fontSans}`;
      ctx.fillText("JAI PRAKASH HOSPITAL & RESEARCH CENTRE", textX, canvas.height - Math.round(18 * scale));

      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(16 * scale)}px ${fontMono}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(`${dateStr} • ${timeStr}`, canvas.width - cardPadding, canvas.height - Math.round(18 * scale));
      ctx.textAlign = 'left'; // reset

      // Strict limit: must be less than 1MB (1,048,576 bytes)
      const TARGET_MAX_BYTES = 0.95 * 1024 * 1024; // ~996KB (guaranteed < 1MB)

      // Export canvas directly with optimal JPEG quality (0.90)
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Empty blob')), 'image/jpeg', 0.90)
      );

      let finalFile = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });

      // If the image already fits safely under 1MB, avoid double-compression generation loss!
      if (finalFile.size > TARGET_MAX_BYTES) {
        setCompressing(true);
        finalFile = await imageCompression(finalFile, {
          maxSizeMB: 0.92, // Target strictly under 1MB
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          initialQuality: 0.85,
        });

        // Fail-safe check in case compression was marginally above 1MB
        if (finalFile.size >= 1024 * 1024) {
          finalFile = await imageCompression(finalFile, {
            maxSizeMB: 0.85,
            maxWidthOrHeight: 1600,
            useWebWorker: true,
          });
        }
      }

      const newEntry = { file: finalFile, preview: URL.createObjectURL(finalFile), type: 'image' };

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

  const processFile = async (f) => {
    if (f.type.startsWith('image/')) {
      try {
        const TARGET_MAX_BYTES = 0.95 * 1024 * 1024;
        let finalFile = f;
        // Ensure image is strictly < 1MB while preserving up to 1920px resolution
        if (f.size > TARGET_MAX_BYTES || f.type !== 'image/jpeg') {
          finalFile = await imageCompression(f, {
            maxSizeMB: 0.92,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
            fileType: 'image/jpeg',
            initialQuality: 0.85,
          });
          if (finalFile.size >= 1024 * 1024) {
            finalFile = await imageCompression(finalFile, {
              maxSizeMB: 0.85,
              maxWidthOrHeight: 1600,
              useWebWorker: true,
            });
          }
        }
        return { file: finalFile, preview: URL.createObjectURL(finalFile), type: 'image' };
      } catch {
        toast.error('Image compression failed');
        return null;
      }
    } else if (f.type === 'application/pdf') {
      if (f.size > 200 * 1024 * 1024) {
        toast.error(`PDF is ${(f.size / 1024 / 1024).toFixed(2)}MB. Each PDF must be under 200MB.`);
        return null;
      }
      return { file: f, preview: null, type: 'pdf' };
    } else {
      toast.error('Unsupported file type');
      return null;
    }
  };

  const processAndSetFile = async (f, pages, fileName, editIndex) => {
    // Check if total count will exceed 10
    if (editIndex === undefined && !(isLegacySingle || single) && files.length >= 10) {
      toast.error('Maximum 10 files allowed from Gallery/Scanner');
      return;
    }

    setCompressing(true);
    try {
      const entry = await processFile(f);
      if (entry) {
        if (pages) entry.scannerPages = pages;
        if (fileName) entry.scannerFileName = fileName;

        if (editIndex !== undefined) {
          const newFiles = [...files];
          newFiles[editIndex] = entry;
          handleChange(newFiles);
        } else if (isLegacySingle || single) {
          handleChange([entry]);
        } else {
          handleChange([...files, entry]);
        }
      }
    } finally {
      setCompressing(false);
      setScannerOpen(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    const spaceLeft = (isLegacySingle || single) ? 1 - files.length : 10 - files.length;
    if (spaceLeft <= 0) {
      toast.error('Maximum 10 files allowed from Gallery');
      return;
    }
    const filesToProcess = acceptedFiles.slice(0, spaceLeft);
    if (acceptedFiles.length > spaceLeft) {
      toast.error('Only the first 10 files will be processed');
    }

    setCompressing(true);
    try {
      const newEntries = [];
      for (const f of filesToProcess) {
        const entry = await processFile(f);
        if (entry) {
          newEntries.push(entry);
        }
      }
      if (newEntries.length > 0) {
        if (isLegacySingle || single) {
          handleChange([newEntries[newEntries.length - 1]]);
        } else {
          handleChange([...files, ...newEntries]);
        }
      }
    } finally {
      setCompressing(false);
    }
  }, [files, isLegacySingle, single]);

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
        <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col overflow-hidden touch-none">
          <div className="flex-1 min-h-0 relative bg-black flex items-center justify-center overflow-hidden">
            <img src={stagedPhoto.preview} alt="Captured preview" className="w-full h-full object-contain" />
          </div>
          <div
            className="bg-gray-900 border-t border-white/10 flex items-center justify-around px-4 flex-shrink-0"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))', paddingTop: '1.5rem', height: 'auto', minHeight: '7rem' }}
          >
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
                  if (files.length >= 20) {
                    toast.error('Maximum 20 photos allowed from Camera');
                    return;
                  }
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
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col overflow-hidden touch-none">
        {/* Video Preview */}
        <div className="relative flex-1 bg-black overflow-hidden">
          <video
            id="jphrc-cfu-video"
            ref={videoRefCallback}
            autoPlay playsInline muted
            onLoadedMetadata={(e) => { setVideoReady(true); e.target.play().catch(() => { }); }}
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
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black/85 to-transparent pt-16 text-white flex gap-3.5 items-end">
              {/* Live Map Box */}
              <div className="w-[96px] h-[96px] bg-gray-900 rounded-lg border-2 border-white/50 flex-shrink-0 relative overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.8)]">
                {effectiveGpsData && !mapError ? (
                  <img
                    src={`https://static-maps.yandex.ru/1.x/?ll=${effectiveGpsData.longitude},${effectiveGpsData.latitude}&z=15&l=map&size=100,100`}
                    className="w-full h-full object-cover opacity-90 contrast-125 saturate-50"
                    alt="map"
                    onError={() => setMapError(true)}
                  />
                ) : effectiveGpsData && mapError ? (
                  // Offline map fallback — show a coordinate grid placeholder
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 gap-0.5 p-1">
                    <div className="grid grid-cols-3 gap-px w-full h-full opacity-30">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="bg-gray-500 rounded-sm" />
                      ))}
                    </div>
                    <span className="absolute text-[8px] font-bold text-blue-300 tracking-wider">OFFLINE</span>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900/80">
                    <Scan className="w-5 h-5 text-blue-500 animate-pulse mb-1" />
                    <span className="text-[9px] font-bold text-gray-400 tracking-wider">LOCATING</span>
                  </div>
                )}
                {effectiveGpsData && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6] border-2 border-white animate-pulse" />
                  </div>
                )}
                {/* Crosshair corners */}
                <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-blue-400" />
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-blue-400" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-end">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="bg-blue-600 text-white text-[11px] px-2 py-0.5 rounded font-black tracking-wider shadow-sm">
                    📍 GEO-TAG
                  </span>
                  <span className="text-xs font-black tracking-wider text-amber-400 uppercase drop-shadow-md">
                    JPHRC Hospital
                  </span>
                  {addressCached && (
                    <span className="text-[10px] font-bold text-orange-200 bg-orange-900/60 px-1.5 py-0.5 rounded border border-orange-500/30">
                      CACHED
                    </span>
                  )}
                  {!navigator.onLine && (
                    <span className="text-[10px] font-bold text-red-200 bg-red-900/60 px-1.5 py-0.5 rounded border border-red-500/30">
                      OFFLINE
                    </span>
                  )}
                </div>
                <div className="font-black text-base sm:text-lg truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-white">
                  JPHRC, Dayanand Nagar 🇮🇳
                </div>
                <div className="text-xs sm:text-sm text-white/90 line-clamp-1 leading-snug drop-shadow-md font-medium">
                  Dandiapali, Rourkela, Odisha 769004
                </div>

                <div className="flex flex-col mt-2 bg-black/70 p-2 px-2.5 rounded-lg border border-white/20 backdrop-blur-md w-fit shadow-lg">
                  <div className="flex gap-4 text-xs sm:text-sm font-mono font-bold text-amber-300 tracking-tight">
                    <span>LAT: {effectiveGpsData ? effectiveGpsData.latitude.toFixed(6) : '--.------'}°</span>
                    <span>LNG: {effectiveGpsData ? effectiveGpsData.longitude.toFixed(6) : '--.------'}°</span>
                  </div>
                  <div className="text-[11px] sm:text-xs font-bold text-gray-300 mt-1 uppercase tracking-wider font-mono">
                    {liveTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} • {liveTime.toLocaleTimeString('en-US', { hour12: false })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Indicators */}
          <div className="absolute left-4 flex flex-col gap-2" style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
            {(capturing || compressing) && (
              <div className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full flex items-center gap-2 shadow-xl animate-pulse">
                <div className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                {compressing ? 'TAGGING & SAVING...' : 'CAPTURING...'}
              </div>
            )}
            {!(isLegacySingle || single) && files.length > 0 && (
              <div className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1.5 rounded-full w-fit border border-white/20">
                {files.length} PHOTOS CAPTURED
              </div>
            )}
          </div>

          {/* Torch Button */}
          {hasTorch && (
            <button
              type="button" onClick={toggleTorch}
              className="absolute right-4 w-10 h-10 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20"
              style={{ top: 'calc(4rem + env(safe-area-inset-top, 0px))' }}
            >
              {torchOn ? <Zap size={20} className="text-yellow-400" fill="currentColor" /> : <ZapOff size={20} />}
            </button>
          )}

          {/* Close Button */}
          <button
            type="button" onClick={stopCamera}
            className="absolute right-4 w-10 h-10 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-white/20"
            style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Shutter Controls */}
        <div
          className="bg-black flex items-center justify-around px-8 border-t border-white/5"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))', paddingTop: '1.5rem', height: 'auto', minHeight: '8rem' }}
        >
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
        <div className="relative inline-block w-full text-center">
          {f.type === 'image' || f.scannerPages ? (
            <div className="relative inline-block cursor-pointer" onClick={() => {
              if (f.scannerPages) setScannerOpen({ index: 0, pages: f.scannerPages, name: f.scannerFileName });
              else setPreviewPhoto(f);
            }}>
              <img src={f.scannerPages ? f.scannerPages[0].preview : f.preview} alt="Preview" 
                className="max-h-[200px] object-contain rounded-xl border-2 border-white shadow-lg mx-auto"
              />
              {f.scannerPages && f.scannerPages.length > 1 && (
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                  <Layers size={12} /> {f.scannerPages.length} Pages
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-[200px] w-[150px] mx-auto bg-red-50 rounded-xl border-2 border-white shadow-lg flex flex-col items-center justify-center gap-2 p-4">
              <FilePdf className="w-8 h-8 text-red-500" />
            </div>
          )}
          <p className="text-sm font-semibold text-gray-800 pt-2 max-w-full truncate px-1" title={f.file.name}>{f.file.name}</p>
          <p className="text-xs text-gray-500">{formatBytes(f.file.size)}</p>
          <div className="flex items-center justify-center gap-1 text-green-600 font-medium">
            <CheckCircle size={14} /><span className="text-xs">Ready to upload</span>
          </div>
          {!disabled && (
            <div className="flex gap-2 justify-center mt-2 relative z-10">
              {f.scannerPages && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setScannerOpen({ index: 0, pages: f.scannerPages, name: f.scannerFileName }); }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-blue-100 shadow-sm transition-colors">
                  <Edit2 size={12} /> Edit pages
                </button>
              )}
              <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(0); }}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-red-100 shadow-sm transition-colors">
                <X size={12} /> Remove file
              </button>
            </div>
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
              <div key={i} className="relative group cursor-pointer" onClick={() => {
                if (f.scannerPages) {
                  setScannerOpen({ index: i, pages: f.scannerPages, name: f.scannerFileName });
                } else if (f.type === 'image') {
                  setPreviewPhoto(f);
                }
              }}>
                {f.type === 'image' || f.scannerPages ? (
                  <img src={f.scannerPages ? f.scannerPages[0].preview : f.preview} alt={`Photo ${i + 1}`}
                    className="w-16 h-16 object-cover rounded-xl border-2 border-white shadow-md group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-16 h-16 bg-red-50 rounded-xl border-2 border-white shadow-md flex items-center justify-center">
                    <FilePdf size={22} className="text-red-400" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                  {f.scannerPages ? <Edit2 size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" /> : <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
                <span className="absolute bottom-0.5 left-0.5 bg-black/50 text-white text-[8px] font-bold px-1 rounded flex items-center gap-0.5 pointer-events-none">
                  {i + 1} {f.scannerPages && f.scannerPages.length > 1 && `· ${f.scannerPages.length}p`}
                </span>
                {!disabled && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center shadow hover:bg-red-600 z-10">
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
            disabled={disabled || compressing || (!(isLegacySingle || single) && files.length >= 20)}
            className={clsx(
              "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
              "border-blue-100 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-300 group",
              (disabled || compressing || (!(isLegacySingle || single) && files.length >= 20)) && "opacity-60 cursor-not-allowed"
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
          onClick={(e) => {
            if (!(isLegacySingle || single) && files.length >= 10) {
              e.preventDefault();
              e.stopPropagation();
              toast.error('Maximum 10 files allowed from Gallery');
              return;
            }
            open();
          }}
          className={clsx(
            "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 border-dashed transition-all cursor-pointer",
            isMobile ? "" : "flex-1",
            isDragActive ? "border-green-400 bg-green-50" : "border-gray-200 bg-gray-50/30 hover:border-gray-300 hover:bg-gray-50",
            (disabled || compressing || (!(isLegacySingle || single) && files.length >= 10)) && "opacity-60 cursor-not-allowed pointer-events-none"
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
            disabled={disabled || compressing || (!(isLegacySingle || single) && files.length >= 10)}
            className={clsx(
              "flex flex-col items-center justify-center py-3 px-1 rounded-xl border-2 transition-all",
              "border-purple-100 bg-purple-50/50 hover:bg-purple-50 hover:border-purple-300 group",
              (disabled || compressing || (!(isLegacySingle || single) && files.length >= 10)) && "opacity-60 cursor-not-allowed"
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

      {/* Document Scanner Component — available on all devices */}
      {scannerOpen && (
        <DocumentScanner
          initialPages={scannerOpen.pages || []}
          initialFileName={scannerOpen.name || ''}
          onClose={() => setScannerOpen(false)}
          onComplete={(pdfFile, pages, fileName) => processAndSetFile(pdfFile, pages, fileName, scannerOpen.index)}
        />
      )}
    </div>
  );
}
