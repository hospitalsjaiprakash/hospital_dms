import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Download, FileText, User, X, ZoomIn, File, Trash2, Edit2, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Button } from '../common';
import { API_URL, DOC_TYPE_LABELS, DOC_TYPE_COLORS } from './constants';

export default function DocumentViewerModal({ doc, onClose }) {
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  if (!doc) return null;

  const isImage = doc.mime_type?.startsWith('image/');
  const isPdf = doc.mime_type === 'application/pdf';
  const fileUrl = doc.presigned_url
    ? (doc.presigned_url.startsWith('http') ? doc.presigned_url : `${API_URL}${doc.presigned_url}`)
    : null;

  const isCompressing = doc.mime_type === 'application/pdf' &&
    doc.file_size >= 2 * 1024 * 1024 &&
    !doc.is_compressed &&
    (Date.now() - new Date(doc.created_at).getTime()) < 5 * 60 * 1000;

  const handleDownload = () => {
    if (isCompressing) {
      toast('PDF is currently being optimized. Please wait a moment.', { icon: '⏳' });
      return;
    }

    const downloadUrl = doc.download_url || fileUrl;
    if (!downloadUrl) {
      toast.error('File not available');
      return;
    }
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const displayName = doc.file_name === 'blob' || doc.file_name === 'image' || !doc.file_name
    ? `${DOC_TYPE_LABELS[doc.doc_type] || 'Document'}`
    : doc.file_name;

  const canAction = doc.canAction;
  const onDelete = doc.onDelete;
  const onEdit = doc.onEdit;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/95 safe-area-inset">
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-5 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={clsx('text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', DOC_TYPE_COLORS[doc.doc_type])}>
            {DOC_TYPE_LABELS[doc.doc_type]}
          </span>
          <p className="text-xs sm:text-sm font-medium text-white truncate">{displayName}</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {canAction && (
            <>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors border border-gray-700"
              >
                <Edit2 size={14} className="text-blue-400" />
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors border border-gray-700"
              >
                <Trash2 size={14} className="text-red-400" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
          {isCompressing ? (
            <button
              onClick={() => toast('PDF is currently being optimized. Please wait a moment.', { icon: '⏳' })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg transition-colors cursor-wait animate-pulse"
            >
              <Clock size={14} className="animate-spin" />
              <span className="hidden xs:inline">Optimizing...</span>
            </button>
          ) : (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Download size={14} />
              <span className="hidden xs:inline">Download</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Viewer Body */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-6 bg-black/40">
        {!fileUrl ? (
          <div className="text-gray-400 text-center">
            <FileText size={64} className="mx-auto mb-4 opacity-20" />
            <p>File not available</p>
          </div>
        ) : isImage ? (
          <img
            src={fileUrl}
            alt={doc.file_name}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            style={{ touchAction: 'pinch-zoom' }}
          />
        ) : isPdf ? (
          <div className="w-full h-full flex flex-col gap-4">
            <div className="flex-1 relative">
              <iframe
                src={`${fileUrl}#toolbar=0`}
                title={doc.file_name}
                className="w-full h-full rounded-lg bg-white border-0"
              />
              <div className="absolute bottom-4 right-4 sm:hidden">
                <button 
                  onClick={() => window.open(fileUrl, '_blank')}
                  className="bg-white/90 backdrop-blur shadow-lg p-3 rounded-full text-blue-600"
                >
                  <ZoomIn size={20} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-center p-8 bg-gray-900/50 rounded-2xl border border-gray-800">
            <File size={64} className="mx-auto mb-4 opacity-20" />
            <p className="mb-6 text-sm">Preview not available for this file type.</p>
            <Button
              onClick={handleDownload}
              className="mx-auto"
            >
              <Download size={16} /> Download to View
            </Button>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-t border-gray-800 text-[10px] sm:text-xs text-gray-400 flex-shrink-0">
        <div className="flex items-center gap-2">
          <User size={12} />
          <span>{doc.uploaded_by_name}</span>
        </div>
        <span>{format(new Date(doc.created_at), 'dd MMM yyyy, hh:mm a')}</span>
      </div>
    </div>,
    document.body
  );
}
