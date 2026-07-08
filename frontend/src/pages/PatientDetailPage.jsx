import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { patientApi, documentApi } from '../services/api';
import * as offlineQueue from '../services/offlineQueue';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, Button, Select, Spinner, EmptyState, Modal, Pagination } from '../components/common';
import DocumentUpload from '../components/documents/DocumentUpload';
import DocumentActionModal from '../components/documents/DocumentActionModal';
import DocumentViewerModal from '../components/documents/DocumentViewerModal';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS, API_URL as CONST_API_URL } from '../components/documents/constants';
import {
  ArrowLeft, Edit2, Upload, Download, FileText, Image,
  Trash2, Eye, Calendar, Hash, User,
  CheckCircle, Clock, Activity, AlertCircle, MoreVertical,
  File, X, ZoomIn, Check, Plus
} from 'lucide-react';
import JSZip from 'jszip';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useForm, Controller } from 'react-hook-form';
import ReactSelect from 'react-select';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));

// --- CONFIGURATION ---
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : `http://${window.location.hostname}:5000`;

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  document_submission: 'indigo', pending: 'amber', completed: 'green',
  none: 'gray'
};

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// ── Readmit Form (full-page, same as NewPatientPage readmit flow) ─────────────
function ReadmitModal({ patient, open, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { refreshCount } = useOfflineSync();
  const [docFiles, setDocFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting }, reset } = useForm({
    defaultValues: {
      ip_number: '',
      admission_date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      doc_type: '',
    }
  });

  const watchDocType = watch('doc_type');

  const handleClose = () => {
    reset();
    setDocFiles([]);
    onClose();
  };

  const onSubmit = async (data) => {
    try {
      if (docFiles.length > 0 && !data.doc_type) {
        toast.error('Please select a document type for the attached files');
        return;
      }

      // Step 1: Create the new admission
      const result = await patientApi.create({
        uhid: patient.uhid,
        name: patient.name,
        ip_number: data.ip_number.trim(),
        admission_date: data.admission_date,
      });
      const newPatientId = result.data.id;

      // Step 2: Upload initial documents if any
      if (docFiles.length > 0) {
        setIsUploading(true);
        setUploadProgress({ done: 0, total: docFiles.length, percent: 0, isCompressing: false });
        let queuedCount = 0;
        for (let i = 0; i < docFiles.length; i++) {
          const f = docFiles[i];
          const fileName = `${data.doc_type}_${i + 1}_${Date.now()}.${f.type === 'pdf' ? 'pdf' : 'jpg'}`;

          if (!navigator.onLine) {
            await offlineQueue.enqueue({
              patientId: newPatientId,
              docType: data.doc_type,
              fileName,
              notes: null,
              fileBlob: f.file,
            });
            queuedCount++;
            setUploadProgress(prev => ({ ...prev, done: i + 1 }));
            continue;
          }

          try {
            const formData = new FormData();
            formData.append('file', f.file, fileName);
            formData.append('patient_id', newPatientId);
            formData.append('doc_type', data.doc_type);
            await documentApi.upload(formData, (progressEvent) => {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(prev => ({
                ...prev,
                percent,
                isCompressing: percent >= 100,
              }));
            });
          } catch (uploadErr) {
            await offlineQueue.enqueue({
              patientId: newPatientId,
              docType: data.doc_type,
              fileName,
              notes: null,
              fileBlob: f.file,
            });
            queuedCount++;
          }
          setUploadProgress(prev => ({
            ...prev,
            done: i + 1,
            percent: 0,
            isCompressing: false,
          }));
        }
        if (queuedCount > 0) {
          await refreshCount();
          toast(`📥 ${queuedCount} file(s) queued — will upload when online.`, {
            icon: '📥',
            duration: 6000,
            style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' },
          });
        }
      }

      queryClient.invalidateQueries('patients');
      queryClient.invalidateQueries('stats');
      queryClient.invalidateQueries(['patient', patient.id]);
      toast.success(docFiles.length > 0
        ? `Re-admitted with ${docFiles.length} document(s)! IP: ${data.ip_number}`
        : `Patient re-admitted! IP: ${data.ip_number}`);
      handleClose();
      navigate(`/patients/${newPatientId}`);
    } catch (err) {
      toast.error(err.message || 'Re-admission failed');
    } finally {
      setIsUploading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="Re-Admit Patient">
      <div className="flex flex-col flex-1 min-h-0 -m-5">
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="max-w-2xl mx-auto space-y-5">

            {/* Header inside modal */}
            <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
              <div>
                <p className="text-sm font-bold text-gray-900">Re-admitting {patient.name}</p>
                <p className="text-xs text-gray-400 font-mono">{patient.uhid}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Full Name — read-only */}
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      readOnly
                      value={patient.name}
                      className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2.5 text-sm bg-gray-50 text-gray-500 cursor-not-allowed font-semibold outline-none"
                    />
                  </div>
                </div>

                {/* UHID — read-only */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">UHID *</label>
                  <div className="relative">
                    <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      readOnly
                      value={patient.uhid}
                      className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2.5 text-sm bg-gray-50 text-gray-500 cursor-not-allowed font-semibold font-mono outline-none"
                    />
                  </div>
                </div>

                {/* New IP Number */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">New IP Number *</label>
                  <div className="relative">
                    <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      placeholder="IP2026/001"
                      className={clsx(
                        'w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500',
                        errors.ip_number ? 'border-red-400' : 'border-gray-200'
                      )}
                      {...register('ip_number', { required: 'IP Number is required' })}
                    />
                  </div>
                  {errors.ip_number && <p className="text-xs text-red-500 mt-1">{errors.ip_number.message}</p>}
                </div>

                {/* Re-admission Date & Time */}
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Re-Admission Date & Time *</label>
                  <div className="relative">
                    <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="datetime-local"
                      max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                      className={clsx(
                        'w-full rounded-lg border pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500',
                        errors.admission_date ? 'border-red-400' : 'border-gray-200'
                      )}
                      {...register('admission_date', { 
                        required: 'Admission date and time is required',
                        validate: (value) => {
                          if (!value) return true;
                          const selectedMs = new Date(value).getTime();
                          const nowMs = Date.now();
                          if (selectedMs > nowMs) {
                            return 'Admission date cannot be in the future';
                          }
                          return true;
                        }
                      })}
                    />
                  </div>
                  {errors.admission_date && <p className="text-xs text-red-500 mt-1">{errors.admission_date.message}</p>}
                </div>
              </div>

              {/* Auto-set info box */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm">
                <p className="font-semibold text-blue-800 mb-1.5">Auto-set on creation:</p>
                <ul className="space-y-1 text-blue-700">
                  <li>• Hospital Status → <strong>Active (Admitted)</strong></li>
                  <li>• Settlement Status → <strong>None</strong></li>
                </ul>
              </div>

              {/* Initial Document section */}
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-gray-800">Initial Document <span className="text-gray-400 font-normal text-sm">(Optional)</span></h3>
                  <p className="text-xs text-gray-500 mb-4">Attach an ID proof or admission photo while creating the patient.</p>
                </div>

                <CameraFileUploader
                  files={docFiles}
                  onChange={setDocFiles}
                  disabled={isSubmitting || isUploading}
                />

                {docFiles.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Type *</label>
                    <Controller
                      name="doc_type"
                      control={control}
                      rules={{ required: docFiles.length > 0 ? 'Please select document type' : false }}
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
                )}
              </div>

              {/* Form Actions */}
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting || isUploading}
                  className="w-full sm:w-auto"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  loading={isSubmitting || isUploading}
                  className="w-full sm:w-auto"
                >
                  {isUploading && uploadProgress
                    ? (uploadProgress.isCompressing
                      ? `Compressing file ${uploadProgress.done + 1}/${uploadProgress.total}, please wait...`
                      : `Uploading file ${uploadProgress.done + 1}/${uploadProgress.total} (${uploadProgress.percent || 0}%)`)
                    : 'Re-admit Patient'
                  }
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Patient Modal ──────────────────────────────────────────────────────
function EditPatientModal({ patient, open, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { refreshCount } = useOfflineSync();
  const [docFile, setDocFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      name: patient.name,
      ip_number: patient.ip_number,
      uhid: patient.uhid,
      admission_date: patient.admission_date ? new Date(new Date(patient.admission_date).getTime() - new Date(patient.admission_date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
      notes: patient.notes || '',
      hospital_status: patient.hospital_status,
      settlement_status: patient.settlement_status || 'none',
      discharge_date: (patient.hospital_status === 'discharged' && patient.discharge_date) ? new Date(new Date(patient.discharge_date).getTime() - new Date(patient.discharge_date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
      document_submission_date: (patient.settlement_status !== 'none' && patient.document_submission_date) ? new Date(new Date(patient.document_submission_date).getTime() - new Date(patient.document_submission_date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
      pending_date: (['pending', 'completed'].includes(patient.settlement_status) && patient.pending_date) ? new Date(new Date(patient.pending_date).getTime() - new Date(patient.pending_date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
      settlement_date: (patient.settlement_status === 'completed' && patient.settlement_date) ? new Date(new Date(patient.settlement_date).getTime() - new Date(patient.settlement_date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
    }
  });

  const watchHospitalStatus = watch('hospital_status');
  const watchSettlementStatus = watch('settlement_status');

  React.useEffect(() => {
    if (watchHospitalStatus === 'active') {
      setValue('settlement_status', 'none');
    }
  }, [watchHospitalStatus, setValue]);

  const { mutateAsync, isLoading } = useMutation(
    (data) => patientApi.update(patient.id, data)
  );

  const isRestricted = ['pcc', 'nursing'].includes(user?.role);

  const onSubmit = async (data) => {
    try {
      const payload = { ...data };
      if (isRestricted) {
        // Prune fields that restricted roles cannot update to prevent backend 403
        delete payload.hospital_status;
        delete payload.settlement_status;
        delete payload.discharge_date;
        delete payload.document_submission_date;
        delete payload.pending_date;
        delete payload.settlement_date;
      } else {
        if (payload.discharge_date === '') payload.discharge_date = null;
        if (payload.document_submission_date === '') payload.document_submission_date = null;
        if (payload.pending_date === '') payload.pending_date = null;
        if (payload.settlement_date === '') payload.settlement_date = null;
      }

      await mutateAsync(payload);

      if (docFile && watchHospitalStatus === 'discharged' && !isRestricted) {
        setIsUploading(true);
        setUploadProgress({ done: 0, total: 1, percent: 0, isCompressing: false });
        const fileName = `discharge_summary_${Date.now()}.${docFile.type === 'pdf' ? 'pdf' : 'jpg'}`;

        if (!navigator.onLine) {
          await offlineQueue.enqueue({
            patientId: patient.id,
            docType: 'discharge_summary',
            fileName,
            notes: null,
            fileBlob: docFile.file,
          });
          await refreshCount();
          toast(`📥 Discharge summary queued — will upload when online.`, {
            icon: '📥',
            duration: 6000,
            style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' },
          });
        } else {
          try {
            const formData = new FormData();
            formData.append('file', docFile.file, fileName);
            formData.append('patient_id', patient.id);
            formData.append('doc_type', 'discharge_summary');
            await documentApi.upload(formData, (progressEvent) => {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(prev => ({
                ...prev,
                percent,
                isCompressing: percent >= 100,
              }));
            });
          } catch (uploadErr) {
            await offlineQueue.enqueue({
              patientId: patient.id,
              docType: 'discharge_summary',
              fileName,
              notes: null,
              fileBlob: docFile.file,
            });
            await refreshCount();
            toast(`📥 Discharge summary queued — will upload when online.`, {
              icon: '📥',
              duration: 6000,
              style: { background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d' },
            });
          }
        }
      }

      queryClient.invalidateQueries(['patient', patient.id]);
      queryClient.invalidateQueries('patients');
      queryClient.invalidateQueries('stats');
      queryClient.invalidateQueries(['documents', patient.id]);
      queryClient.invalidateQueries('audit-logs');
      toast.success(docFile ? 'Patient updated and discharge summary uploaded!' : 'Patient updated!');
      onClose();
    } catch (err) {
      toast.error(err.message || 'An error occurred during update');
    } finally {
      setIsUploading(false);
    }
  };

  const getSettlementOptions = () => {
    if (user?.role === 'admin') {
      return [
        { value: 'none', label: 'Discharged (None)' },
        { value: 'document_submission', label: 'Document Submission' },
        { value: 'pending', label: 'PMJAY Pending' },
        { value: 'completed', label: 'PMJAY Settled' }
      ];
    }

    const current = patient.settlement_status || 'none';
    if (current === 'none') {
      return [
        { value: 'none', label: 'Discharged (None)' },
        { value: 'document_submission', label: 'Move to Document Submission' }
      ];
    }
    if (current === 'document_submission') {
      return [
        { value: 'document_submission', label: 'Document Submission' },
        { value: 'pending', label: 'Move to PMJAY Pending' }
      ];
    }
    if (current === 'pending') {
      return [
        { value: 'pending', label: 'PMJAY Pending' },
        { value: 'completed', label: 'Move to PMJAY Settled' }
      ];
    }
    if (current === 'completed') {
      return [
        { value: 'completed', label: 'PMJAY Settled' }
      ];
    }
    return [{ value: 'none', label: 'None' }];
  };

  return (
    <Modal 
      open={open} 
      onClose={onClose} 
      title="Edit Patient"
      footer={
        <div className="flex gap-3 w-full">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1" disabled={isLoading || isUploading}>Cancel</Button>
          <Button type="submit" form="edit-patient-form" loading={isLoading || isUploading} className="flex-1">
            {isUploading && uploadProgress
              ? (uploadProgress.isCompressing 
                ? 'Compressing file, please wait...' 
                : `Uploading file (${uploadProgress.percent || 0}%)`)
              : 'Save Changes'
            }
          </Button>
        </div>
      }
    >
      <form id="edit-patient-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              disabled={isRestricted}
              {...register('name', { required: 'Name required' })} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">IP Number *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              disabled={isRestricted}
              {...register('ip_number', { required: 'IP required' })} />
            {errors.ip_number && <p className="text-xs text-red-500">{errors.ip_number.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">UHID *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              disabled={isRestricted}
              {...register('uhid', { 
                required: 'UHID required',
                pattern: { value: /^[A-Z0-9]{11}$/, message: 'Invalid UHID (11 chars)' }
              })} />
            {errors.uhid && <p className="text-xs text-red-500">{errors.uhid.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Admission Date & Time *</label>
            <input 
              type="datetime-local" 
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              disabled={isRestricted}
              {...register('admission_date', { 
                required: 'Admission date required',
                validate: (value) => {
                  if (!value) return true;
                  const selectedMs = new Date(value).getTime();
                  const nowMs = Date.now();
                  
                  // Allow if it matches the original date (with 1 minute tolerance for truncation)
                  if (patient.admission_date) {
                    const originalMs = new Date(patient.admission_date).getTime();
                    if (Math.abs(selectedMs - originalMs) < 60000) {
                      return true;
                    }
                  }

                  if (selectedMs > nowMs) {
                    return 'Admission date cannot be in the future';
                  }
                  return true;
                }
              })} 
            />
            {errors.admission_date && <p className="text-xs text-red-500">{errors.admission_date.message}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Notes</label>
          <textarea 
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 h-20 disabled:bg-gray-50 disabled:text-gray-500"
            disabled={isRestricted}
            {...register('notes')}
            placeholder="Additional notes..."
          />
        </div>

        <>
            {/* Hospital Status */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Hospital Status</label>
              <select 
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={patient.hospital_status === 'discharged' && user?.role !== 'admin'}
                {...register('hospital_status')}
              >
                <option value="active">Active (Admitted)</option>
                <option value="discharged">Discharged</option>
              </select>
              {patient.hospital_status === 'discharged' && user?.role !== 'admin' && (
                <p className="text-[10px] text-gray-400">Status cannot be changed back to Active. Use the "Re-admit" action on the patient page to admit them again.</p>
              )}
              {patient.hospital_status === 'discharged' && user?.role === 'admin' && (
                <p className="text-[10px] text-amber-500 font-medium">Admin access: You can revert to Active. This will clear all discharge and settlement dates.</p>
              )}
            </div>

            {/* Discharge fields — only when discharged */}
            {watchHospitalStatus === 'discharged' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Discharge Date & Time</label>
                  <input 
                    type="datetime-local" 
                    max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    {...register('discharge_date', {
                      validate: (value) => {
                        if (!value) return true;
                        const selectedMs = new Date(value).getTime();
                        const admissionMs = patient.admission_date ? new Date(patient.admission_date).getTime() : 0;
                        if (admissionMs && selectedMs < admissionMs) {
                          return 'Discharge date cannot be before admission';
                        }
                        const nowMs = Date.now();
                        if (selectedMs > nowMs) {
                          return 'Discharge date cannot be in the future';
                        }
                        return true;
                      }
                    })} 
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave blank to use the current date/time automatically.</p>
                  {errors.discharge_date && <p className="text-xs text-red-500 mt-1">{errors.discharge_date.message}</p>}
                </div>

                {!isRestricted && (
                  <>
                    {/* PMJAY Settlement Dropdown */}
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">PMJAY Settlement Status</label>
                      <select 
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        {...register('settlement_status')}
                      >
                        {getSettlementOptions().map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Document Submission Date */}
                    {(watchSettlementStatus === 'document_submission' || patient.settlement_status === 'document_submission' || patient.document_submission_date) && (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Submission Date & Time</label>
                        <input
                          type="datetime-local"
                          max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                          disabled={patient.settlement_status !== 'none' && patient.settlement_status !== 'document_submission'}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                          {...register('document_submission_date')}
                        />
                      </div>
                    )}

                    {/* PMJAY Pending Date */}
                    {(watchSettlementStatus === 'pending' || patient.settlement_status === 'pending' || patient.pending_date) && (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">PMJAY Pending Date & Time</label>
                        <input
                          type="datetime-local"
                          max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                          disabled={patient.settlement_status !== 'document_submission' && patient.settlement_status !== 'pending'}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                          {...register('pending_date')}
                        />
                      </div>
                    )}

                    {/* PMJAY Settlement Date */}
                    {(watchSettlementStatus === 'completed' || patient.settlement_status === 'completed' || patient.settlement_date) && (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">PMJAY Settlement Date & Time</label>
                        <input
                          type="datetime-local"
                          max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                          disabled={patient.settlement_status !== 'pending' && patient.settlement_status !== 'completed'}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
                          {...register('settlement_date')}
                        />
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-1 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Upload Discharge Summary (Optional)</label>
                  <CameraFileUploader file={docFile} onChange={setDocFile} disabled={isLoading || isUploading} />
                </div>
              </div>
            )}
          </>

        {/* Global Validation Errors */}
        {Object.keys(errors).length > 0 && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 flex items-start gap-2.5 shadow-sm animate-pulse">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">Please correct the following errors:</span>
              <ul className="list-disc pl-4 space-y-0.5 font-medium font-sans">
                {Object.entries(errors).map(([key, err]) => (
                  <li key={key}>{err.message || `${key} has an error`}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

      </form>
    </Modal>
  );
}


// ── Document Card ──────────────────────────────────────────────────────────
function DocumentCard({ doc, onDelete, canDelete, onView, isSelected, onSelect }) {
  const isImage = doc.mime_type?.startsWith('image/');
  const fileUrl = doc.presigned_url
    ? (doc.presigned_url.startsWith('http') ? doc.presigned_url : `${CONST_API_URL}${doc.presigned_url}`)
    : null;

  const displayName = doc.file_name === 'blob' || doc.file_name === 'image' || !doc.file_name || doc.file_name.startsWith('photo_')
    ? `${DOC_TYPE_LABELS[doc.doc_type] || 'Document'}`
    : doc.file_name.replace(/_\d{13}/g, '');

  const isCompressing = doc.mime_type === 'application/pdf' &&
    doc.file_size >= 1 * 1024 * 1024 &&
    !doc.is_compressed &&
    (Date.now() - new Date(doc.created_at).getTime()) < 5 * 60 * 1000;

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (isCompressing) {
      toast('PDF is currently being optimized. Please wait a moment.', { icon: '⏳' });
      return;
    }

    const downloadUrl = doc.download_url || fileUrl;
    if (!downloadUrl) return;

    // Use the backend-provided download URL which includes Content-Disposition
    const a = document.createElement('a');
    a.href = downloadUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSelect = (e) => {
    e.stopPropagation();
    onSelect(doc.id);
  };

  return (
    <div className={clsx("bg-white border rounded-xl overflow-hidden hover:shadow-card-hover transition-all group", isSelected ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-gray-100')}>
      <div className="h-32 bg-gray-50 flex items-center justify-center relative overflow-hidden cursor-pointer" onClick={() => onView(doc)}>
        {isImage && fileUrl ? (
          <img
            src={fileUrl}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-red-500" />
            </div>
            <span className="text-xs text-gray-400 font-medium">PDF</span>
          </div>
        )}
        {/* Checkbox - Modern Browser Style */}
        <div className="absolute top-2 left-2 z-20">
          <div 
            className={clsx(
              "flex items-center justify-center p-1.5 rounded-lg shadow-sm border transition-all",
              isSelected ? "bg-blue-600 border-blue-600" : "bg-white/80 backdrop-blur-sm border-gray-200 hover:bg-white"
            )}
            onClick={(e) => { e.stopPropagation(); onSelect(doc.id); }}
          >
            <input
              type="checkbox"
              className={clsx(
                "w-4 h-4 rounded border-gray-300 focus:ring-blue-500 cursor-pointer",
                isSelected ? "accent-white" : "text-blue-600"
              )}
              checked={isSelected}
              readOnly
            />
          </div>
        </div>
        {/* Actions (Always visible on mobile, hover on desktop) */}
        <div className="absolute inset-0 bg-black/10 sm:bg-black/0 sm:group-hover:bg-black/20 transition-colors flex items-center justify-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); onView(doc); }} className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-md hover:bg-blue-50 transition-colors">
            <Eye size={14} className="text-blue-600" />
          </button>
          {fileUrl && (
            isCompressing ? (
              <button 
                onClick={(e) => { e.stopPropagation(); toast('PDF is currently being optimized. Please wait a moment.', { icon: '⏳' }); }}
                className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-md hover:bg-amber-50 transition-colors cursor-wait"
              >
                <Clock size={14} className="text-amber-500 animate-pulse" />
              </button>
            ) : (
              <button onClick={handleDownload} className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-md hover:bg-green-50 transition-colors">
                <Download size={14} className="text-green-600" />
              </button>
            )
          )}
          {canDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(doc); }} className="p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-md hover:bg-red-50 transition-colors">
              <Trash2 size={14} className="text-red-500" />
            </button>
          )}
        </div>
      </div>

      <div className="p-3">
        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full border', DOC_TYPE_COLORS[doc.doc_type])}>
          {DOC_TYPE_LABELS[doc.doc_type]}
        </span>
        <p className="text-xs text-gray-500 mt-2 truncate">{displayName}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {format(new Date(doc.created_at), 'dd MMM yyyy, hh:mm a')}
        </p>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-gray-400 truncate">by {doc.uploaded_by_name}</p>
          <span className="text-[10px] text-gray-500 font-medium bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
            {formatBytes(doc.file_size)}
          </span>
        </div>
        {doc.updated_by && (
          <p className="text-[10px] text-blue-500 font-bold truncate mt-0.5 bg-blue-50 rounded px-1 w-fit">
            Edited by {doc.updated_by_name}
          </p>
        )}
        {doc.notes && <p className="text-xs text-gray-500 mt-1.5 bg-gray-50 rounded-md px-2 py-1 break-words whitespace-pre-wrap">{doc.notes}</p>}
        {/* Per-document download button */}
        {fileUrl && (
          isCompressing ? (
            <div className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg border border-amber-100 animate-pulse cursor-wait">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
              Optimizing size...
            </div>
          ) : (
            <button
              onClick={handleDownload}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-100"
            >
              <Download size={12} />
              Download
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canEdit } = useAuth();
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  const [activeDocType, setActiveDocType] = useState('all');
  const [docPage, setDocPage] = useState(1);
  const [selectedDocs, setSelectedDocs] = useState(new Map());
  const [isDownloading, setIsDownloading] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [actionDocId, setActionDocId] = useState(null);
  const [deletePatientOpen, setDeletePatientOpen] = useState(false);
  const [readmitOpen, setReadmitOpen] = useState(false);

  const { data: patientData, isLoading: patientLoading } = useQuery(
    ['patient', id],
    () => patientApi.getOne(id)
  );

  const { data: docsData, isLoading: docsLoading } = useQuery(
    ['documents', id, activeDocType, docPage],
    () => documentApi.getForPatient(id, {
      doc_type: activeDocType !== 'all' ? activeDocType : undefined,
      page: docPage,
      limit: 12,
    }),
    { 
      enabled: !!id,
      refetchInterval: (data) => {
        const hasCompressing = data?.data?.some(doc => 
          doc.mime_type === 'application/pdf' && 
          doc.file_size >= 1 * 1024 * 1024 && 
          !doc.is_compressed && 
          (Date.now() - new Date(doc.created_at).getTime()) < 5 * 60 * 1000
        );
        return hasCompressing ? 4000 : false;
      }
    }
  );

  const hasCompressingDocs = docsData?.data?.some(doc => 
    doc.mime_type === 'application/pdf' && 
    doc.file_size >= 1 * 1024 * 1024 && 
    !doc.is_compressed && 
    (Date.now() - new Date(doc.created_at).getTime()) < 5 * 60 * 1000
  ) || false;

  const { mutate: deleteDocument, isLoading: deleting } = useMutation(
    (docId) => documentApi.delete(docId),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['documents', id]);
        toast.success('Document deleted');
        setDeleteDoc(null);
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const { mutate: bulkDeleteDocuments, isLoading: bulkDeleting } = useMutation(
    (ids) => documentApi.bulkDelete(ids),
    {
      onSuccess: (res) => {
        queryClient.invalidateQueries(['documents', id]);
        toast.success(res.message || 'Documents deleted');
        setSelectedDocs(new Map());
        setShowBulkDeleteModal(false);
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const { mutate: deletePatient, isLoading: deletingPatient } = useMutation(
    () => patientApi.delete(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('patients');
        queryClient.invalidateQueries('stats');
        toast.success('Patient deleted successfully');
        navigate('/patients');
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const handleToggleDocSelect = (doc) => {
    setSelectedDocs(prev => {
      const newSelected = new Map(prev);
      if (newSelected.has(doc.id)) {
        newSelected.delete(doc.id);
      } else {
        newSelected.set(doc.id, doc);
      }
      return newSelected;
    });
  };

  const handleSelectAllDocs = () => {
    const allCurrentSelected = docs.every(doc => selectedDocs.has(doc.id));
    if (allCurrentSelected && docs.length > 0) {
      setSelectedDocs(prev => {
        const newSelected = new Map(prev);
        docs.forEach(doc => newSelected.delete(doc.id));
        return newSelected;
      });
    } else {
      setSelectedDocs(prev => {
        const newSelected = new Map(prev);
        docs.forEach(doc => newSelected.set(doc.id, doc));
        return newSelected;
      });
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedDocs.size === 0) {
      const allDocs = docsData?.data || [];
      if (allDocs.length === 0) {
        toast.error('No documents to download');
        return;
      }
      setSelectedDocs(new Map(allDocs.map(doc => [doc.id, doc])));
      return;
    }

    try {
      setIsDownloading(true);
      toast.loading('Preparing download...');

      const selectedDocObjs = Array.from(selectedDocs.values());

      if (selectedDocObjs.length === 1) {
        // Single file download
        const doc = selectedDocObjs[0];
        const blob = await documentApi.downloadRaw(doc.id);
        let baseName = '';
        if (doc.doc_type === 'other' && doc.file_name && !doc.file_name.startsWith('blob') && !doc.file_name.startsWith('image') && !doc.file_name.startsWith('photo_')) {
          baseName = doc.file_name.replace(/\.[^/.]+$/, "");
        } else {
          baseName = DOC_TYPE_LABELS[doc.doc_type] || 'Document';
        }
        const uhid = patient.uhid || doc.patient_uhid || '';
        let downloadName = `${baseName} ${uhid}`.trim().replace(/[!@#$%^&*()_+.\/,><?";:]/g, '');
        
        const ext = doc.mime_type === 'application/pdf' ? '.pdf' : (doc.mime_type === 'image/png' ? '.png' : '.jpg');
        const name = `${downloadName}${ext}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Multiple files as ZIP
        const zip = new JSZip();
        const usedNames = new Set();

        for (const doc of selectedDocObjs) {
          try {
            const blob = await documentApi.downloadRaw(doc.id);
            let baseName = '';
            if (doc.doc_type === 'other' && doc.file_name && !doc.file_name.startsWith('blob') && !doc.file_name.startsWith('image') && !doc.file_name.startsWith('photo_')) {
              baseName = doc.file_name.replace(/\.[^/.]+$/, "");
            } else {
              baseName = DOC_TYPE_LABELS[doc.doc_type] || 'Document';
            }
            const uhid = patient.uhid || doc.patient_uhid || '';
            let downloadName = `${baseName} ${uhid}`.trim().replace(/[!@#$%^&*()_+.\/,><?";:]/g, '');
            
            const ext = doc.mime_type === 'application/pdf' ? '.pdf' : (doc.mime_type === 'image/png' ? '.png' : '.jpg');
            
            let name = `${downloadName}${ext}`;
            let counter = 1;
            while (usedNames.has(name)) {
              name = `${downloadName} (${counter})${ext}`;
              counter++;
            }
            usedNames.add(name);
            
            zip.file(name, blob);
          } catch (e) {
            console.error(`Failed to download document ${doc.id} for zipping:`, e);
          }
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${patient.uhid}_documents.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }

      toast.dismiss();
      toast.success(`Downloaded ${selectedDocObjs.length} file${selectedDocObjs.length > 1 ? 's' : ''}!`);
      setSelectedDocs(new Map());
    } catch (err) {
      toast.dismiss();
      toast.error(err.message || 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  if (patientLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  const patient = patientData?.data;
  if (!patient) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Patient not found</p>
        <Button onClick={() => navigate('/patients')} variant="ghost" className="mt-3">Back to Patients</Button>
      </div>
    );
  }

  const docs = docsData?.data || [];
  const docsPagination = docsData?.pagination;
  const canUpload = patient.settlement_status !== 'completed';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Readmit Modal */}
      {readmitOpen && (
        <ReadmitModal patient={patient} open={readmitOpen} onClose={() => setReadmitOpen(false)} />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => navigate('/patients')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors self-start">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{patient.name}</h1>
          <div className="flex items-center gap-2">
            <p className="text-gray-400 text-sm font-mono">{patient.uhid}</p>
            <span className="text-gray-300">•</span>
            <span className="text-blue-600 text-xs font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">IP: {patient.ip_number}</span>
          </div>
        </div>
        <div className="hidden sm:flex gap-2 flex-wrap">
          {selectedDocs.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setShowBulkDeleteModal(true)}>
              <Trash2 size={13} /> Delete ({selectedDocs.size})
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Edit2 size={13} /> Edit
          </Button>
          {patient.hospital_status === 'discharged' && (
            <Button 
              variant="success" 
              size="sm" 
            onClick={() => setReadmitOpen(true)}
            >
              <Plus size={13} /> Re-admit
            </Button>
          )}
          <Button size="sm" onClick={handleDownloadSelected} loading={isDownloading} variant={selectedDocs.size > 0 ? "primary" : "secondary"}>
            <Download size={13} /> {selectedDocs.size === 0 ? 'Download All' : `Download ${selectedDocs.size} File${selectedDocs.size > 1 ? 's' : ''}`}
          </Button>
          {canUpload && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload size={13} /> Upload Doc
            </Button>
          )}
        </div>
        <div className="sm:hidden flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)} className="flex-1">
            <Edit2 size={13} /> Edit
          </Button>
          {canUpload && (
            <Button size="sm" onClick={() => setUploadOpen(true)} className="flex-1">
              <Upload size={13} /> Upload
            </Button>
          )}
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-4 sm:gap-6 lg:gap-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar size={14} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Admitted</p>
              <p className="text-sm font-semibold text-gray-800">
                {format(new Date(patient.admission_date), 'dd MMM yyyy')}
                <span className="text-xs font-normal text-gray-500 ml-1">at {format(new Date(patient.created_at), 'hh:mm a')}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Created By</p>
              <p className="text-sm font-semibold text-gray-800">
                {patient.created_by_name || 'System'}
              </p>
            </div>
          </div>

          {patient.discharge_date && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle size={14} className="text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Discharged</p>
                <p className="text-sm font-semibold text-gray-800">
                  {format(new Date(patient.discharge_date), 'dd MMM yyyy')}
                  <span className="text-xs font-normal text-gray-500 ml-1">at {format(new Date(patient.discharge_date), 'hh:mm a')}</span>
                </p>
              </div>
            </div>
          )}

          {patient.document_submission_date && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileText size={14} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Doc Submission</p>
                <p className="text-sm font-semibold text-gray-800">
                  {format(new Date(patient.document_submission_date), 'dd MMM yyyy')}
                  <span className="text-xs font-normal text-gray-500 ml-1">at {format(new Date(patient.document_submission_date), 'hh:mm a')}</span>
                </p>
              </div>
            </div>
          )}

          {patient.pending_date && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Clock size={14} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">PMJAY Pending</p>
                <p className="text-sm font-semibold text-gray-800">
                  {format(new Date(patient.pending_date), 'dd MMM yyyy')}
                  <span className="text-xs font-normal text-gray-500 ml-1">at {format(new Date(patient.pending_date), 'hh:mm a')}</span>
                </p>
              </div>
            </div>
          )}

          {patient.settlement_date && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle size={14} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">PMJAY Settled</p>
                <p className="text-sm font-semibold text-gray-800">
                  {format(new Date(patient.settlement_date), 'dd MMM yyyy')}
                  <span className="text-xs font-normal text-gray-500 ml-1">at {format(new Date(patient.settlement_date), 'hh:mm a')}</span>
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <File size={14} className="text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Documents</p>
              <p className="text-sm font-semibold text-gray-800">{patient.document_count ?? '—'}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-50">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 font-medium">Hospital:</span>
            <Badge variant={STATUS_COLORS[patient.hospital_status]}>
              {patient.hospital_status === 'active' ? '🟢' : '🔵'} {patient.hospital_status}
            </Badge>
          </div>
          {patient.hospital_status === 'discharged' && patient.settlement_status && patient.settlement_status !== 'none' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Settlement:</span>
              <Badge variant={STATUS_COLORS[patient.settlement_status]}>
                {patient.settlement_status === 'completed' ? '💰' : '⏳'} {patient.settlement_status === 'document_submission' ? 'doc submission' : patient.settlement_status}
              </Badge>
            </div>
          )}
          {['admin', 'hod'].includes(user?.role) && (
            <Button variant="danger" size="sm" onClick={() => setDeletePatientOpen(true)} className="w-fit self-end sm:w-auto sm:self-auto">
              <Trash2 size={13} /> <span className="sm:hidden">Delete Profile</span><span className="hidden sm:inline">Delete Patient Profile</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Admission History */}
      {patient.admission_history?.length > 0 && (
        <Card className="!bg-blue-50/30 !border-blue-100/50">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-blue-600" />
            <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Admission History</h3>
            <span className="text-xs text-blue-400 font-medium">({patient.admission_history.length} other visits found)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {patient.admission_history.map((h) => (
              <Link 
                key={h.id} 
                to={`/patients/${h.id}`}
                className="bg-white border border-blue-100 rounded-xl p-3 hover:shadow-md hover:border-blue-300 transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">IP: {h.ip_number}</span>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={STATUS_COLORS[h.hospital_status]} size="xs">{h.hospital_status}</Badge>
                    {h.hospital_status === 'discharged' && h.settlement_status && h.settlement_status !== 'none' && (
                      <Badge variant={STATUS_COLORS[h.settlement_status]} size="xs">
                        {h.settlement_status === 'document_submission' ? 'doc submission' : h.settlement_status}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <Calendar size={12} className="text-gray-400" />
                    <span className="font-medium">Admitted: {format(new Date(h.admission_date), 'dd MMM yyyy')}</span>
                  </div>
                  {h.discharge_date && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <CheckCircle size={12} className="text-purple-400" />
                      <span className="font-medium text-purple-700">Discharged: {format(new Date(h.discharge_date), 'dd MMM yyyy')}</span>
                    </div>
                  )}
                  {h.pending_date && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <Clock size={12} className="text-amber-500" />
                      <span className="font-medium text-amber-700">Pending: {format(new Date(h.pending_date), 'dd MMM yyyy')}</span>
                    </div>
                  )}
                  {h.settlement_date && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <CheckCircle size={12} className="text-green-500" />
                      <span className="font-medium text-green-700">PMJAY: {format(new Date(h.settlement_date), 'dd MMM yyyy')}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                      <File size={10} /> {h.doc_count || 0} docs
                    </div>
                    <div className="text-[10px] text-gray-400 italic">by {h.staff_name}</div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <span className="text-[10px] text-blue-500 font-bold group-hover:underline">View Records →</span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-gray-800">Documents</h2>
            {docs.length > 0 && (
              <label className="flex items-center gap-2 px-2 py-1 bg-gray-50 border border-gray-100 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={docs.length > 0 && selectedDocs.size === docs.length}
                  onChange={handleSelectAllDocs}
                />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select All</span>
              </label>
            )}
          </div>
        </div>

        {/* Document Category Filter */}
        <div className="mb-4 sm:max-w-xs relative z-50">
          <ReactSelect 
            options={[
              { value: 'all', label: `All Documents (${docsPagination?.total ?? 0})` },
              ...Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }))
            ]}
            value={
              activeDocType === 'all' 
                ? { value: 'all', label: `All Documents (${docsPagination?.total ?? 0})` } 
                : { value: activeDocType, label: DOC_TYPE_LABELS[activeDocType] }
            }
            onChange={(val) => { setActiveDocType(val.value); setDocPage(1); }}
            placeholder="Search categories..."
            className="text-sm"
            styles={{
              control: (base, state) => ({
                ...base,
                borderColor: state.isFocused ? '#3b82f6' : '#e5e7eb',
                borderRadius: '0.5rem',
                minHeight: '40px',
                boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
                '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#d1d5db' }
              }),
              menu: (base) => ({ ...base, zIndex: 50 })
            }}
          />
        </div>

        {docsLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents"
            description="No documents found for this patient."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 sm:gap-3">
              {docs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  canDelete={canEdit(doc.uploaded_by, doc.uploader_role)}
                  onDelete={setDeleteDoc}
                  onView={setViewDoc}
                  isSelected={selectedDocs.has(doc.id)}
                  onSelect={() => handleToggleDocSelect(doc)}
                />
              ))}
            </div>
            {docsPagination && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <Pagination pagination={docsPagination} onPageChange={setDocPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Document Viewer */}
      {(() => {
        const activeViewDoc = viewDoc ? (docs.find(d => d.id === viewDoc.id) || viewDoc) : null;
        return activeViewDoc && (
          <DocumentViewerModal 
            doc={{
              ...activeViewDoc,
              canAction: canEdit(activeViewDoc.uploaded_by, activeViewDoc.uploader_role),
              onDelete: () => { setViewDoc(null); setDeleteDoc(activeViewDoc); },
              onEdit: () => { setViewDoc(null); setActionDocId(activeViewDoc.id); }
            }} 
            onClose={() => setViewDoc(null)} 
          />
        );
      })()}

      {actionDocId && (
        <DocumentActionModal 
          docId={actionDocId} 
          open={!!actionDocId} 
          onClose={() => setActionDocId(null)} 
        />
      )}

      {uploadOpen && (
        <DocumentUpload patientId={id} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      )}

      {editOpen && patient && (
        <EditPatientModal patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
      )}

      <Modal open={!!deleteDoc} onClose={() => setDeleteDoc(null)} title="Delete Document" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Delete this document?</p>
              <p className="text-xs text-red-600 mt-1">{deleteDoc?.file_name}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDeleteDoc(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => deleteDocument(deleteDoc.id)} className="flex-1">
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal 
        open={showBulkDeleteModal} 
        onClose={() => setShowBulkDeleteModal(false)} 
        title={selectedDocs.size === 1 ? "Delete Document" : "Delete Multiple Documents"} 
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                Delete {selectedDocs.size} document{selectedDocs.size !== 1 ? 's' : ''}?
              </p>
              <p className="text-xs text-red-600 mt-1">
                This action cannot be undone and will remove all selected files from the system.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowBulkDeleteModal(false)} className="flex-1">Cancel</Button>
            <Button variant="danger" loading={bulkDeleting} onClick={() => bulkDeleteDocuments(Array.from(selectedDocs.keys()))} className="flex-1">
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={deletePatientOpen} onClose={() => setDeletePatientOpen(false)} title="Delete Patient Record" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Permanent Deletion</p>
              <p className="text-xs text-red-600 mt-1">
                You are about to delete <strong>{patient.name}</strong> and all associated documents. This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDeletePatientOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="danger" loading={deletingPatient} onClick={() => deletePatient()} className="flex-1">
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Floating Bulk Actions Bar (Mobile only) */}
      {selectedDocs.size > 0 && !showBulkDeleteModal && !deleteDoc && !viewDoc && !uploadOpen && !editOpen && (
        <div className="sm:hidden fixed bottom-[72px] left-4 right-4 z-50 bg-white rounded-2xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-4 animate-slide-up">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gray-900">{selectedDocs.size} selected</span>
              <button 
                onClick={() => setSelectedDocs(new Map())}
                className="text-[10px] font-bold text-blue-600 uppercase tracking-wider hover:text-blue-700 text-left"
              >
                Clear Selection
              </button>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="danger" 
                size="sm" 
                onClick={() => setShowBulkDeleteModal(true)}
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </Button>
              <Button 
                variant="primary" 
                size="sm" 
                loading={isDownloading}
                onClick={handleDownloadSelected}
              >
                <Download size={14} />
                <span>Download</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}