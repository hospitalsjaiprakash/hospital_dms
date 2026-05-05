import React, { useState } from 'react';
import { useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import { documentApi } from '../../services/api';
import { Button, Select, Modal } from '../common';
import CameraFileUploader from './CameraFileUploader';
import { Upload } from 'lucide-react';
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
  const [file, setFile] = useState(null);
  const [compressing, setCompressing] = useState(false);
  
  // register handles the ref forwarding automatically now that common/Index is fixed
  const { register, handleSubmit, formState: { errors }, reset } = useForm();

  const { mutate, isLoading } = useMutation(documentApi.upload, {
    onSuccess: () => {
      queryClient.invalidateQueries(['documents', patientId]);
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



  const onSubmit = async (data) => {
    if (!file) { toast.error('Please select a file'); return; }
    const formData = new FormData();
    
    let fileName = file.file.name;
    if (!fileName || fileName === 'blob' || fileName === 'image') {
      const ext = file.type === 'pdf' ? 'pdf' : 'jpg';
      fileName = `${data.doc_type}_${Date.now()}.${ext}`;
    } else if (!fileName.includes('.')) {
      const ext = file.type === 'pdf' ? 'pdf' : 'jpg';
      fileName = `${fileName}.${ext}`;
    }

    formData.append('file', file.file, fileName);
    formData.append('patient_id', patientId);
    formData.append('doc_type', data.doc_type);
    if (data.notes) formData.append('notes', data.notes);
    mutate(formData);
  };



  return (
    <Modal open={open} onClose={handleClose} title="Upload Document" maxWidth="max-w-md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <CameraFileUploader 
          file={file} 
          onChange={setFile} 
          disabled={isLoading} 
        />

        {/* Ref fixed via forwardRef in common/Index */}
        <Select
          label="Type" required
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