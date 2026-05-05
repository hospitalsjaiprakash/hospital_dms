import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from 'react-query';
import imageCompression from 'browser-image-compression';
import { documentApi } from '../../services/api';
import { Button } from '../common';
import { DOC_TYPE_LABELS } from './constants';
import { Camera, X, Upload, ZoomIn } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));

// ── Photo thumbnail ──────────────────────────────────────────────────────────
function PhotoThumb({ photo, index, onRemove, onClick }) {
  return (
    <div className="relative group cursor-pointer" onClick={() => onClick(photo)}>
      <img
        src={photo.preview}
        alt={`Photo ${index + 1}`}
        className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-md transition-transform group-hover:scale-105"
      />
      <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
      >
        <X size={10} />
      </button>
      <span className="absolute bottom-1 left-1 bg-black/50 text-white text-[9px] font-bold px-1 rounded">
        {index + 1}
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MultiCameraUpload({ patientId, open, onClose }) {
  const queryClient = useQueryClient();

  const [photos, setPhotos]             = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const [compressing, setCompressing]   = useState(false);
  const [docType, setDocType]           = useState('other');
  const [notes, setNotes]               = useState('');
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Keep stream in a ref so the video ref-callback can always access it
  const streamRef = useRef(null);

  // ── Clean up stream on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ── Video ref callback — fires the instant <video> mounts in the DOM ───────
  // This is the key fix: srcObject is assigned synchronously when React adds
  // the video element, before any useEffect or rAF timing issues.
  const videoRefCallback = useCallback((videoEl) => {
    if (videoEl && streamRef.current) {
      videoEl.srcObject = streamRef.current;
      videoEl.play().catch(() => {});
    }
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      // Try rear camera with specific resolution, fall back to any camera
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
      setCameraActive(true); // triggers re-render → <video> mounts → videoRefCallback fires
    } catch (err) {
      toast.error('Camera access denied. Please allow camera permission in your browser.');
      console.error('Camera error:', err);
    }
  };

  // ── Stop camera ────────────────────────────────────────────────────────────
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // ── Capture photo ──────────────────────────────────────────────────────────
  const capturePhoto = async () => {
    if (capturing || compressing) return;

    // Find the video element via stream tracks
    const videoEl = document.getElementById('jphrc-camera-video');
    if (!videoEl) {
      toast.error('Camera not ready');
      return;
    }

    // Check video is actually playing with valid frame
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      toast.error('Camera is still loading, please wait a moment');
      return;
    }

    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext('2d').drawImage(videoEl, 0, 0);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('Canvas produced empty blob')),
          'image/jpeg',
          0.90
        );
      });

      const rawFile = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });

      setCompressing(true);
      const compressed = await imageCompression(rawFile, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });

      const preview = URL.createObjectURL(compressed);
      setPhotos(prev => [...prev, { file: compressed, preview }]);
      toast.success(`Photo ${photos.length + 1} captured! 📷`, { duration: 1500 });
    } catch (err) {
      console.error('Capture error:', err);
      toast.error('Capture failed — please try again');
    } finally {
      setCapturing(false);
      setCompressing(false);
    }
  };

  // ── Remove photo ───────────────────────────────────────────────────────────
  const removePhoto = (index) => {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
    setPreviewPhoto(null);
  };

  // ── Upload all photos ──────────────────────────────────────────────────────
  const handleUploadAll = async () => {
    if (photos.length === 0) { toast.error('No photos to upload'); return; }

    setUploadProgress({ done: 0, total: photos.length });
    let successCount = 0;

    for (let i = 0; i < photos.length; i++) {
      try {
        const photo = photos[i];
        const formData = new FormData();
        const fileName = `${docType}_${i + 1}_${Date.now()}.jpg`;
        formData.append('file', photo.file, fileName);
        formData.append('patient_id', patientId);
        formData.append('doc_type', docType);
        if (notes) formData.append('notes', notes);
        await documentApi.upload(formData);
        successCount++;
      } catch (err) {
        toast.error(`Photo ${i + 1} failed: ${err.message}`);
      }
      setUploadProgress({ done: i + 1, total: photos.length });
    }

    if (successCount > 0) {
      queryClient.invalidateQueries(['documents', patientId]);
      queryClient.invalidateQueries('stats');
      toast.success(`${successCount} of ${photos.length} photos uploaded!`);
    }
    handleClose();
  };

  // ── Close / cleanup ────────────────────────────────────────────────────────
  const handleClose = () => {
    stopCamera();
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setDocType('other');
    setNotes('');
    setPreviewPhoto(null);
    setUploadProgress(null);
    onClose();
  };

  if (!open) return null;

  const isUploading = !!uploadProgress;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={!isUploading && !cameraActive ? handleClose : undefined} />

      <div className={`relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden ${cameraActive ? 'sm:w-full sm:h-screen sm:rounded-0' : ''}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <Camera size={16} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 text-sm">Multi-Photo Capture</h2>
              <p className="text-gray-400 text-xs">{photos.length} photo{photos.length !== 1 ? 's' : ''} captured</p>
            </div>
          </div>
          {!isUploading && !cameraActive && (
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── Camera View ─────────────────────────────────────────────── */}
          {cameraActive && (
            <div className="relative bg-black flex-1" style={{ aspectRatio: 'auto' }}>
              {/* 
                The `id` lets capturePhoto find the element without ref timing issues.
                `videoRefCallback` assigns srcObject the instant this element mounts.
              */}
              <video
                id="jphrc-camera-video"
                ref={videoRefCallback}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) => e.target.play().catch(() => {})}
                onCanPlay={(e) => e.target.play().catch(() => {})}
                className="w-full h-full object-cover"
                style={{ display: 'block' }}
              />

              {/* Flash on capture */}
              {capturing && (
                <div className="absolute inset-0 bg-white/50 pointer-events-none" />
              )}

              {/* Status badges */}
              <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {photos.length} captured
              </div>
              {(capturing || compressing) && (
                <div className="absolute top-3 left-3 bg-blue-600/90 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {compressing ? 'Processing...' : 'Capturing...'}
                </div>
              )}

              {/* Camera controls */}
              <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center gap-8">
                {/* Cancel */}
                <button
                  type="button"
                  onClick={stopCamera}
                  className="w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-white transition-colors"
                >
                  <X size={20} />
                </button>

                {/* Shutter */}
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={capturing || compressing}
                  className="w-18 h-18 relative flex items-center justify-center disabled:opacity-50"
                  style={{ width: 72, height: 72 }}
                >
                  <div className="absolute inset-0 rounded-full border-4 border-white/70" />
                  <div className={clsx(
                    'w-14 h-14 rounded-full transition-all duration-100',
                    capturing || compressing ? 'bg-gray-300 scale-90' : 'bg-white active:scale-90'
                  )} />
                </button>

                {/* Done */}
                <button
                  type="button"
                  onClick={stopCamera}
                  className="w-12 h-12 bg-blue-500/80 hover:bg-blue-500 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-xs font-bold transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* ── Photo Grid & Upload Form ─────────────────────────────────── */}
          {!cameraActive && (
            <div className="p-5 space-y-5">
              {photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
                    <Camera size={28} className="text-blue-400" />
                  </div>
                  <p className="text-gray-600 font-semibold text-sm">No photos yet</p>
                  <p className="text-gray-400 text-xs max-w-xs">
                    Open the camera to capture multiple photos. Each will be uploaded separately.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-700">Captured Photos</p>
                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
                      {photos.length} photo{photos.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {photos.map((photo, i) => (
                      <PhotoThumb
                        key={i}
                        photo={photo}
                        index={i}
                        onRemove={removePhoto}
                        onClick={setPreviewPhoto}
                      />
                    ))}

                    {/* ── Inline + Add More button ── */}
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="w-20 h-20 rounded-xl border-2 border-dashed border-blue-300 hover:border-blue-500 bg-blue-50 hover:bg-blue-100 flex flex-col items-center justify-center gap-1 text-blue-500 hover:text-blue-700 transition-all active:scale-95"
                        title="Take more photos"
                      >
                        <div className="w-7 h-7 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center text-white text-lg font-bold leading-none">
                          +
                        </div>
                        <span className="text-[9px] font-semibold uppercase tracking-wide">Add</span>
                      </button>
                    )}
                  </div>
                </div>
              )}



              {/* Upload settings — only if photos exist */}
              {photos.length > 0 && (
                <div className="space-y-3 pt-1 border-t border-gray-100">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={docType}
                      onChange={e => setDocType(e.target.value)}
                      disabled={isUploading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {DOC_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Notes (optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Any additional notes..."
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      disabled={isUploading}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Upload progress bar */}
        {isUploading && (
          <div className="px-5 py-3 bg-blue-50 border-t border-blue-100 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-blue-700">Uploading photos...</span>
              <span className="text-xs text-blue-600">{uploadProgress.done}/{uploadProgress.total}</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        {!cameraActive && (
          <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <Button variant="secondary" onClick={handleClose} disabled={isUploading} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleUploadAll}
              disabled={photos.length === 0 || isUploading}
              loading={isUploading}
              className="flex-1"
            >
              <Upload size={14} />
              Upload {photos.length > 0 ? `${photos.length} Photo${photos.length !== 1 ? 's' : ''}` : 'Photos'}
            </Button>
          </div>
        )}
      </div>

      {/* Full-screen preview */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full"
            onClick={() => setPreviewPhoto(null)}
          >
            <X size={20} />
          </button>
          <img
            src={previewPhoto.preview}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
