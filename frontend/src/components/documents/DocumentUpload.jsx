import React, { useState } from 'react';
import { useMutation, useQueryClient } from 'react-query';
import { useForm, Controller } from 'react-hook-form';
import ReactSelect from 'react-select';
import { documentApi } from '../../services/api';
import { Button, Select, Modal } from '../common';
import CameraFileUploader from './CameraFileUploader';
import { DOC_TYPE_LABELS } from './constants';
import { Upload, X, File } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export default function DocumentUpload({ patientId, open, onClose }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [tempFile, setTempFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  
  const { register, handleSubmit, control, formState: { errors }, reset, watch } = useForm({
    defaultValues: { doc_type: '', custom_file_name: '', notes: '' }
  });

  const docType = watch('doc_type');
  const notes = watch('notes');

  const handleClose = () => {
    setFiles([]);
    setUploadProgress(null);
    reset();
    onClose();
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadAll = async () => {
    if (files.length === 0) { 
      toast.error('No documents captured/selected'); 
      return; 
    }
    if (!docType) {
      toast.error('Please select document type');
      return;
    }

    setUploadProgress({ done: 0, total: files.length, currentPercent: 0, isCompressing: false });
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const fileItem = files[i];
        const formData = new FormData();
        
        const customFileNameInput = watch('custom_file_name')?.trim();
        const ext = fileItem.type === 'pdf' ? 'pdf' : 'jpg';
        
        let fileName;
        if (docType === 'other' && customFileNameInput) {
          const sanitized = customFileNameInput.replace(/[^a-zA-Z0-9_-]/g, '_');
          fileName = files.length > 1
            ? `${sanitized}_${i + 1}_${Date.now()}.${ext}`
            : `${sanitized}_${Date.now()}.${ext}`;
        } else {
          fileName = fileItem.name;
          if (!fileName || fileName === 'blob' || fileName === 'image') {
            fileName = `${docType}_${i + 1}_${Date.now()}.${ext}`;
          } else if (!fileName.includes('.')) {
            fileName = `${fileName}.${ext}`;
          }
        }

        formData.append('file', fileItem.file, fileName);
        formData.append('patient_id', patientId);
        formData.append('doc_type', docType);
        const effectiveNotes = notes?.trim() || '';
        if (effectiveNotes) formData.append('notes', effectiveNotes);
        
        await documentApi.upload(formData, (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(prev => ({
            ...prev,
            currentPercent: percent,
            isCompressing: percent >= 100,
          }));
        });
        successCount++;
      } catch (err) {
        toast.error(`File ${i + 1} failed: ${err.message}`);
      }
      setUploadProgress(prev => ({ ...prev, done: i + 1, currentPercent: 0, isCompressing: false }));
    }

    if (successCount > 0) {
      queryClient.invalidateQueries(['documents', patientId]);
      queryClient.invalidateQueries(['patient', patientId]);
      queryClient.invalidateQueries('stats');
      queryClient.invalidateQueries('audit-logs');
      toast.success(`${successCount} document(s) uploaded successfully!`);
    }
    handleClose();
  };

  const isUploading = !!uploadProgress;

  return (
    <Modal open={open} onClose={handleClose} title="Upload Documents" maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* File Input Section */}
        {!isUploading && (
          <div className="space-y-4">
            <CameraFileUploader 
              files={files} 
              onChange={setFiles} 
              disabled={isUploading} 
            />

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Type *</label>
                <Controller
                  name="doc_type"
                  control={control}
                  rules={{ required: 'Please select document type' }}
                  render={({ field }) => (
                    <ReactSelect
                      {...field}
                      options={DOC_TYPES}
                      value={DOC_TYPES.find(c => c.value === field.value) || null}
                      onChange={val => field.onChange(val.value)}
                      placeholder="Search or select type..."
                      className="text-sm"
                      menuPortalTarget={document.body}
                      styles={{
                        control: (base, state) => ({
                          ...base,
                          borderColor: errors.doc_type ? '#ef4444' : (state.isFocused ? '#3b82f6' : '#e5e7eb'),
                          borderRadius: '0.5rem',
                          minHeight: '42px',
                          boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
                          '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#d1d5db' }
                        }),
                        menuPortal: (base) => ({ ...base, zIndex: 9999 })
                      }}
                    />
                  )}
                />
                {errors.doc_type && <p className="text-xs text-red-500 mt-1">{errors.doc_type.message}</p>}
              </div>

              {docType === 'other' && (
                <div className="space-y-1 animate-fade-in">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Rename File / Custom File Name</label>
                  <input
                    placeholder="Enter custom file name (optional)..."
                    className={clsx(
                      "w-full rounded-lg border px-3 py-2 min-h-[42px] text-sm focus:ring-2 focus:border-transparent outline-none transition-colors",
                      errors.custom_file_name ? "border-red-400 focus:ring-red-500" : "border-gray-200 focus:ring-blue-500 hover:border-gray-300"
                    )}
                    {...register('custom_file_name')}
                  />
                </div>
              )}
            </div>

            {/* Notes Field */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Notes <span className="text-gray-400 font-normal normal-case">(Optional)</span></label>
              <textarea
                rows={3}
                placeholder="Add any relevant notes or remarks about this document..."
                className={clsx(
                  "w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:border-transparent outline-none transition-colors resize-none",
                  errors.notes ? "border-red-400 focus:ring-red-500" : "border-gray-200 focus:ring-blue-500 hover:border-gray-300"
                )}
                {...register('notes')}
              />
            </div>

            {files.length > 0 && (
              <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 text-center">
                <p className="text-xs font-medium text-blue-700">
                  You have <span className="font-bold">{files.length}</span> document(s) ready for upload.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Upload Progress */}
        {isUploading && uploadProgress.done < uploadProgress.total && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm font-semibold text-gray-700 mb-2">
              {uploadProgress.isCompressing 
                ? `🔄 Compressing file ${uploadProgress.done + 1}/${uploadProgress.total}...`
                : `📤 Uploading file ${uploadProgress.done + 1}/${uploadProgress.total}... (${uploadProgress.currentPercent || 0}%)`
              }
            </p>
            {uploadProgress.isCompressing && (
              <p className="text-xs text-gray-500 mb-2">
                This may take a moment for large PDFs. Do not close this window.
              </p>
            )}
            <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
              <div 
                className={clsx(
                  "h-full transition-all duration-300",
                  uploadProgress.isCompressing ? "bg-amber-500 animate-pulse w-full" : "bg-blue-600"
                )}
                style={{ width: uploadProgress.isCompressing ? '100%' : `${uploadProgress.currentPercent || 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-1">
          <Button 
            variant="secondary" 
            type="button" 
            onClick={handleClose} 
            className="flex-1"
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Cancel'}
          </Button>
          <Button 
            type="button" 
            onClick={handleUploadAll} 
            className="flex-1"
            disabled={files.length === 0 || isUploading}
            loading={isUploading}
          >
            <Upload size={14} /> Upload {files.length > 0 && `(${files.length})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}