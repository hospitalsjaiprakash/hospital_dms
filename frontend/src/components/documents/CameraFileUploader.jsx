import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import imageCompression from 'browser-image-compression';
import { Upload, Camera, X, CheckCircle, FileText as FilePdf, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Button } from '../common';

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
      canvas.getContext('2d').drawImage(videoEl, 0, 0);

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
        // Stay in camera mode to allow more captures
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'application/pdf': [] },
    maxFiles: (isLegacySingle || single) ? 1 : 10,
    disabled: disabled || compressing || mode === 'camera',
  });

  // ── Camera View ─────────────────────────────────────────────────────────────
  if (mode === 'camera') {
    return (
      <div className="fixed inset-0 md:fixed md:inset-auto md:rounded-xl md:overflow-hidden bg-black relative md:relative md:max-w-lg md:mx-auto md:mt-4" style={{ aspectRatio: 'auto' }}>
        <video
          id="jphrc-cfu-video"
          ref={videoRefCallback}
          autoPlay playsInline muted
          onLoadedMetadata={(e) => { setVideoReady(true); e.target.play().catch(() => {}); }}
          onCanPlay={(e) => { setVideoReady(true); e.target.play().catch(() => {}); }}
          className="w-full h-full object-cover md:object-cover"
          style={{ display: 'block' }}
        />

        {!videoReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white bg-black/60">
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-xs font-medium">Starting camera...</p>
          </div>
        )}

        {/* Photo counter (multi mode) */}
        {!(isLegacySingle || single) && files.length > 0 && (
          <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {files.length} captured
          </div>
        )}

        {(capturing || compressing) && (
          <div className="absolute top-3 left-3 bg-blue-600/90 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            {compressing ? 'Processing...' : 'Capturing...'}
          </div>
        )}

        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 px-4 md:bottom-4 md:px-4 md:gap-4">
          <Button variant="danger" type="button" onClick={stopCamera} disabled={capturing || compressing}>
            {(isLegacySingle || single) ? 'Cancel' : `Done (${files.length})`}
          </Button>
          <Button
            variant="primary" type="button" onClick={capturePhoto}
            disabled={capturing || compressing || !videoReady}
            className="px-8"
          >
            {capturing || compressing ? (
              <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Processing...</>
            ) : (
              <><Camera size={16} className="mr-1" /> Capture</>
            )}
          </Button>
        </div>
      </div>
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

            {/* ── + Add More tile ── */}
            {!disabled && !compressing && (
              <button type="button" onClick={startCamera}
                className="w-16 h-16 rounded-xl border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50 hover:bg-blue-100 flex flex-col items-center justify-center gap-0.5 text-blue-500 hover:text-blue-700 transition-all active:scale-95"
                title="Take more photos"
              >
                <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-base font-bold leading-none">+</div>
                <span className="text-[8px] font-semibold uppercase tracking-wide">Add</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dropzone — always shown in multi mode */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all',
          isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50',
          (disabled || compressing) && 'pointer-events-none opacity-60'
        )}
      >
        <input {...getInputProps()} />
        {compressing ? (
          <div className="space-y-2">
            <div className="w-7 h-7 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <p className="text-sm text-blue-600 font-medium">Processing...</p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mx-auto">
              <Upload className="w-5 h-5 text-blue-500" />
            </div>
            <p className="text-sm font-medium text-gray-700">
              {isDragActive ? 'Drop file here' : files.length > 0 ? 'Drop more files here' : 'Drag & drop or click to select'}
            </p>
            <p className="text-xs text-gray-400">JPG, PNG, PDF · Max 1MB each</p>
          </div>
        )}
      </div>

      {!disabled && !compressing && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px bg-gray-200 flex-1" />
            <span className="text-xs text-gray-400 font-medium uppercase">OR</span>
            <div className="h-px bg-gray-200 flex-1" />
          </div>
          <Button variant="secondary" type="button" className="w-full"
            onClick={(e) => { e.stopPropagation(); startCamera(); }}>
            <Camera size={16} className="mr-2" />
            {files.length > 0 ? 'Take More Photos' : 'Take Photo with Camera'}
          </Button>
        </>
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
    </div>
  );
}
