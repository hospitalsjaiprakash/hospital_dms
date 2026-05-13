import React, { useState } from 'react';
import { useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import { documentApi } from '../../services/api';
import { Button, Select, Modal } from '../common';
import CameraFileUploader from './CameraFileUploader';
import { Upload, X, File } from 'lucide-react';
import toast from 'react-hot-toast';

const DOC_TYPES = [
  { value: 'id_proof', label: 'ID Proof' },
  { value: 'ayushman_card', label: 'Ayushman Card' },
  { value: 'admission_photo', label: 'Admission Photo' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab_reports', label: 'Lab Reports' },
  { value: 'scans', label: 'Scans / Radiology' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'other', label: 'Other' },
];

export default function DocumentUpload({ patientId, open, onClose }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [tempFile, setTempFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  
  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm({
    defaultValues: { doc_type: 'other', notes: '' }
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

    setUploadProgress({ done: 0, total: files.length });
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const fileItem = files[i];
        const formData = new FormData();
        
        let fileName = fileItem.name;
        if (!fileName || fileName === 'blob' || fileName === 'image') {
          const ext = fileItem.type === 'pdf' ? 'pdf' : 'jpg';
          fileName = `${docType}_${i + 1}_${Date.now()}.${ext}`;
        } else if (!fileName.includes('.')) {
          const ext = fileItem.type === 'pdf' ? 'pdf' : 'jpg';
          fileName = `${fileName}.${ext}`;
        }

        formData.append('file', fileItem.file, fileName);
        formData.append('patient_id', patientId);
        formData.append('doc_type', docType);
        if (notes) formData.append('notes', notes);
        
        await documentApi.upload(formData);
        successCount++;
      } catch (err) {
        toast.error(`File ${i + 1} failed: ${err.message}`);
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }

    if (successCount > 0) {
      queryClient.invalidateQueries(['documents', patientId]);
      queryClient.invalidateQueries(['patient', patientId]);
      queryClient.invalidateQueries('stats');
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Document Type" required
                error={errors.doc_type?.message}
                {...register('doc_type', { required: 'Please select document type' })}
              >
                <option value="">Select type...</option>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Notes (optional)</label>
                <input
                  placeholder="Any additional notes..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none hover:border-gray-300"
                  {...register('notes')}
                />
              </div>
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
        {isUploading && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">
              Uploading... ({uploadProgress.done}/{uploadProgress.total})
            </p>
            <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-300"
                style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
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