import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useForm, Controller } from 'react-hook-form';
import { documentApi } from '../../services/api';
import ReactSelect from 'react-select';
import { Modal, Button, Spinner } from '../common';
import { AlertCircle, Download, Edit2, Eye, File, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from './constants';
import DocumentViewerModal from './DocumentViewerModal';
import CameraFileUploader from './CameraFileUploader';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import clsx from 'clsx';

export default function DocumentActionModal({ docId, open, onClose }) {
  const queryClient = useQueryClient();
  const { canEdit } = useAuth();
  const [viewDoc, setViewDoc] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [file, setFile] = useState(null);

  const { data, isLoading, error } = useQuery(
    ['document', docId],
    () => documentApi.getOne(docId),
    { enabled: !!docId && open, retry: false }
  );

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm();
  
  React.useEffect(() => {
    if (data?.data) {
      reset({ doc_type: data.data.doc_type, notes: data.data.notes || '' });
      setFile(null);
    }
  }, [data, reset, open]);

  const { mutate: updateDoc, isLoading: updating } = useMutation(
    (payload) => documentApi.update(docId, payload),
    {
      onSuccess: () => {
        toast.success('Document updated successfully');
        setFile(null);
        queryClient.invalidateQueries(['document', docId]);
        queryClient.invalidateQueries(['documents']);
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const handleUpdate = (formData) => {
    if (file) {
      const data = new FormData();
      let fileName = file.file.name;
      if (!fileName || fileName === 'blob' || fileName === 'image') {
        const ext = file.type === 'pdf' ? 'pdf' : 'jpg';
        fileName = `${formData.doc_type}_${Date.now()}.${ext}`;
      } else if (!fileName.includes('.')) {
        const ext = file.type === 'pdf' ? 'pdf' : 'jpg';
        fileName = `${fileName}.${ext}`;
      }
      data.append('file', file.file, fileName);
      data.append('doc_type', formData.doc_type);
      if (formData.notes) data.append('notes', formData.notes);
      updateDoc(data);
    } else {
      updateDoc(formData);
    }
  };

  const { mutate: deleteDoc, isLoading: deleting } = useMutation(
    () => documentApi.delete(docId),
    {
      onSuccess: () => {
        toast.success('Document deleted successfully');
        queryClient.invalidateQueries(['audit-logs']);
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }
  );

  if (!open) return null;

  if (isLoading) {
    return (
      <Modal open={open} onClose={onClose} title="Document Details" maxWidth="max-w-md">
        <div className="flex justify-center py-12"><Spinner /></div>
      </Modal>
    );
  }

  if (error || !data?.data || data?.data.is_deleted) {
    return (
      <Modal open={open} onClose={onClose} title="Document Details" maxWidth="max-w-md">
        <div className="text-center py-8">
          <File className="w-16 h-16 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Document not found or has been deleted.</p>
          <Button onClick={onClose} variant="secondary" className="mt-4">Close</Button>
        </div>
      </Modal>
    );
  }

  const doc = data.data;
  const hasEditPermission = canEdit(doc.uploaded_by, doc.uploader_role);

  const handleDownload = () => {
    if (!doc.presigned_url) {
      toast.error('File not available');
      return;
    }
    
    let downloadName = doc.file_name || 'document';
    if (downloadName === 'blob' || downloadName === 'image') {
      downloadName = `${DOC_TYPE_LABELS[doc.doc_type] || 'document'}_${new Date(doc.created_at).getTime()}`;
    }
    
    if (!downloadName.includes('.')) {
      if (doc.mime_type === 'application/pdf') downloadName += '.pdf';
      else if (doc.mime_type === 'image/jpeg') downloadName += '.jpg';
      else if (doc.mime_type === 'image/png') downloadName += '.png';
      else downloadName += '.jpg';
    }

    const downloadUrl = doc.presigned_url.includes('?') 
      ? `${doc.presigned_url}&download=${encodeURIComponent(downloadName)}` 
      : `${doc.presigned_url}?download=${encodeURIComponent(downloadName)}`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Document Actions" maxWidth="max-w-md">
        <div className="space-y-6">
          
          {/* Metadata Display */}
          <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 border border-gray-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold">Type</p>
                <span className={clsx('mt-1 inline-block text-xs font-semibold px-2 py-0.5 rounded-full border', DOC_TYPE_COLORS[doc.doc_type])}>
                  {DOC_TYPE_LABELS[doc.doc_type]}
                </span>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase font-semibold">Uploaded At</p>
                <p className="text-sm font-medium text-gray-900 mt-1">{format(new Date(doc.created_at), 'dd MMM yyyy, hh:mm a')}</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200/60">
              <p className="text-xs text-gray-500 uppercase font-semibold">Uploader</p>
              <div className="flex items-center gap-1.5 mt-1">
                <User size={14} className="text-gray-400" />
                <p className="text-sm font-medium text-gray-900">{doc.uploaded_by_name} ({doc.uploader_role.toUpperCase()})</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setViewDoc(doc)} className="px-2">
              <Eye size={16} /> <span className="truncate">Preview</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDownload} className="px-2">
              <Download size={16} /> <span className="truncate">Download</span>
            </Button>
            {hasEditPermission && (
              <Button variant="danger" size="sm" onClick={() => setDeleteConfirmOpen(true)} className="px-2">
                <Trash2 size={16} /> <span className="truncate">Delete</span>
              </Button>
            )}
          </div>

          {/* Edit Form */}
          {hasEditPermission && (
            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <Edit2 size={16} className="text-blue-500" /> Edit Metadata & Re-upload
              </h3>
              <form onSubmit={handleSubmit(handleUpdate)} className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Replace Document File (Optional)</label>
                  <CameraFileUploader file={file} onChange={setFile} disabled={updating} />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Type *</label>
                  <Controller
                    name="doc_type"
                    control={control}
                    rules={{ required: 'Please select document type' }}
                    render={({ field }) => {
                      const options = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));
                      return (
                        <ReactSelect
                          {...field}
                          options={options}
                          value={options.find(c => c.value === field.value) || null}
                          onChange={val => field.onChange(val.value)}
                          placeholder="Search or select type..."
                          className="text-sm"
                          menuPortalTarget={document.body}
                          styles={{
                            control: (base, state) => ({
                              ...base,
                              borderColor: errors?.doc_type ? '#ef4444' : (state.isFocused ? '#3b82f6' : '#e5e7eb'),
                              borderRadius: '0.5rem',
                              minHeight: '42px',
                              boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
                              '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#d1d5db' }
                            }),
                            menuPortal: (base) => ({ ...base, zIndex: 9999 })
                          }}
                        />
                      );
                    }}
                  />
                  {errors?.doc_type && <p className="text-xs text-red-500 mt-1">{errors.doc_type.message}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Notes</label>
                  <textarea
                    rows={2}
                    placeholder="Any additional notes..."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    {...register('notes')}
                  />
                </div>

                <div className="flex justify-end pt-2 pb-6">
                  <Button type="submit" loading={updating}>Save Changes</Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </Modal>

      {/* View Document Modal */}
      {viewDoc && (
        <DocumentViewerModal doc={viewDoc} onClose={() => setViewDoc(null)} />
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Confirm Delete" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Are you sure?</p>
              <p className="text-xs text-red-600 mt-1">This document will be permanently deleted and cannot be recovered.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => deleteDoc()} className="flex-1">Yes, Delete</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
