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
    setTempFile(null);
    setUploadProgress(null);
    reset();
    onClose();
  };

  const handleAddFile = () => {
    if (!tempFile) { 
      toast.error('Please select a file'); 
      return; 
    }
    if (!docType) { 
      toast.error('Please select document type'); 
      return; 
    }

    const newFile = {
      id: Date.now(),
      file: tempFile.file,
      type: tempFile.type,
      name: tempFile.file.name,
      docType,
      notes,
      preview: tempFile.preview
    };

    setFiles(prev => [...prev, newFile]);
    setTempFile(null);
    toast.success('Document added to queue!', { duration: 1000 });
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleUploadAll = async () => {
    if (files.length === 0) { 
      toast.error('No documents to upload'); 
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
          fileName = `${fileItem.docType}_${i + 1}_${Date.now()}.${ext}`;
        } else if (!fileName.includes('.')) {
          const ext = fileItem.type === 'pdf' ? 'pdf' : 'jpg';
          fileName = `${fileName}.${ext}`;
        }

        formData.append('file', fileItem.file, fileName);
        formData.append('patient_id', patientId);
        formData.append('doc_type', fileItem.docType);
        if (fileItem.notes) formData.append('notes', fileItem.notes);
        
        await documentApi.upload(formData);
        successCount++;
      } catch (err) {
        toast.error(`Document ${i + 1} failed: ${err.message}`);
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }

    if (successCount > 0) {
      queryClient.invalidateQueries(['documents', patientId]);
      queryClient.invalidateQueries('stats');
      toast.success(`${successCount} of ${files.length} documents uploaded!`);
    }
    handleClose();
  };

  const isUploading = !!uploadProgress;

  return (
    <Modal open={open} onClose={handleClose} title="Upload Documents" maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* File Input Section */}
        {!isUploading && (
          <>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Document</h3>
              
              <CameraFileUploader 
                file={tempFile} 
                onChange={setTempFile} 
                disabled={isUploading} 
              />

              <Select
                label="Type" required
                error={errors.doc_type?.message}
                className="mt-3"
                {...register('doc_type', { required: 'Please select document type' })}
              >
                <option value="">Select type...</option>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>

              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Any additional notes..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none hover:border-gray-300"
                  {...register('notes')}
                />
              </div>

              <Button 
                type="button" 
                onClick={handleAddFile}
                className="w-full mt-3"
                disabled={!tempFile}
              >
                <Upload size={14} /> Add to Queue
              </Button>
            </div>

            {/* Files Queue */}
            {files.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  Documents Ready ({files.length})
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {files.map((f, idx) => (
                    <div 
                      key={f.id} 
                      className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <File size={16} className="text-blue-600 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-700 truncate">{f.name || `Document ${idx + 1}`}</p>
                          <p className="text-xs text-gray-500">{f.docType} • {DOC_TYPES.find(t => t.value === f.docType)?.label || f.docType}</p>
                          {f.notes && <p className="text-xs text-gray-400 truncate italic">{f.notes}</p>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(f.id)}
                        className="ml-2 p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition flex-shrink-0"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
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