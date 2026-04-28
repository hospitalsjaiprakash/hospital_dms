import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import imageCompression from 'browser-image-compression';
import { documentApi } from '../../services/api';
import { Button, Select, Modal } from '../common';
import { Upload, FileImage, FileText as FilePdf, X, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

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
  const [file, setFile] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset } = useForm();

  const { mutate, isLoading } = useMutation(documentApi.upload, {
    onSuccess: () => {
      queryClient.invalidateQueries(['documents', patientId]);
      queryClient.invalidateQueries('stats');
      toast.success('Document uploaded successfully!');
      handleClose();
    },
    onError: (err) => toast.error(err.message || 'Upload failed'),
  });

  const handleClose = () => {
    setFile(null);
    reset();
    onClose();
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    const f = acceptedFiles[0];
    if (!f) return;

    const MAX_SIZE = 1 * 1024 * 1024; // 1MB

    if (f.type.startsWith('image/')) {
      setCompressing(true);
      try {
        const compressed = await imageCompression(f, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        setFile({ file: compressed, preview: URL.createObjectURL(compressed), type: 'image' });
      } catch {
        toast.error('Compression failed');
      } finally {
        setCompressing(false);
      }
    } else if (f.type === 'application/pdf') {
      if (f.size > MAX_SIZE) {
        toast.error('PDF must be under 1MB');
        return;
      }
      setFile({ file: f, preview: null, type: 'pdf' });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'application/pdf': [] },
    maxFiles: 1,
    disabled: isLoading || compressing,
  });

  const onSubmit = async (data) => {
    if (!file) { toast.error('Please select a file'); return; }
    const formData = new FormData();
    formData.append('file', file.file);
    formData.append('patient_id', patientId);
    formData.append('doc_type', data.doc_type);
    if (data.notes) formData.append('notes', data.notes);
    mutate(formData);
  };

  const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <Modal open={open} onClose={handleClose} title="Upload Document" maxWidth="max-w-md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
            isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50',
            (isLoading || compressing) && 'pointer-events-none opacity-60'
          )}
        >
          <input {...getInputProps()} />

          {compressing ? (
            <div className="space-y-2">
              <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-blue-600 font-medium">Compressing image...</p>
            </div>
          ) : file ? (
            <div className="space-y-2">
              {file.type === 'image' ? (
                <img src={file.preview} alt="Preview" className="w-20 h-20 object-cover rounded-lg mx-auto border border-gray-200" />
              ) : (
                <div className="w-16 h-16 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
                  <FilePdf className="w-8 h-8 text-red-500" />
                </div>
              )}
              <p className="text-sm font-semibold text-gray-700">{file.file.name}</p>
              <p className="text-xs text-gray-400">{formatBytes(file.file.size)}</p>
              <div className="flex items-center justify-center gap-1 text-green-600">
                <CheckCircle size={13} />
                <span className="text-xs font-medium">Ready to upload</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto"
              >
                <X size={12} /> Remove file
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {isDragActive ? 'Drop file here' : 'Drag & drop or click to select'}
                </p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF · Max 1MB (images auto-compressed)</p>
              </div>
            </div>
          )}
        </div>

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
          <textarea
            rows={2}
            placeholder="Any additional notes..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none hover:border-gray-300"
            {...register('notes')}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" type="button" onClick={handleClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={isLoading} disabled={!file} className="flex-1">
            <Upload size={14} /> Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}
