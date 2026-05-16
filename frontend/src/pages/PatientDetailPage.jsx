import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { patientApi, documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, Button, Select, Spinner, EmptyState, Modal } from '../components/common';
import DocumentUpload from '../components/documents/DocumentUpload';
import DocumentActionModal from '../components/documents/DocumentActionModal';
import DocumentViewerModal from '../components/documents/DocumentViewerModal';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS, API_URL as CONST_API_URL } from '../components/documents/constants';
import {
  ArrowLeft, Edit2, Upload, Download, FileText, Image,
  Trash2, Eye, Calendar, Hash, User,
  CheckCircle, Clock, Activity, AlertCircle, MoreVertical,
  File, X, ZoomIn, Check
} from 'lucide-react';
import JSZip from 'jszip';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import ReactSelect from 'react-select';

// --- CONFIGURATION ---
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : `http://${window.location.hostname}:5000`;

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

// ── Edit Patient Modal ──────────────────────────────────────────────────────
function EditPatientModal({ patient, open, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [docFile, setDocFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      name: patient.name,
      hospital_status: patient.hospital_status,
      settlement_status: patient.settlement_status,
      discharge_date: patient.discharge_date ? new Date(patient.discharge_date).toISOString().slice(0, 16) : '',
      settlement_date: patient.settlement_date ? new Date(patient.settlement_date).toISOString().slice(0, 16) : '',
    }
  });

  const watchHospitalStatus = watch('hospital_status');
  const watchSettlementStatus = watch('settlement_status');

  const { mutateAsync, isLoading } = useMutation(
    (data) => patientApi.update(patient.id, data)
  );

  const onSubmit = async (data) => {
    try {
      const payload = { ...data };
      if (payload.discharge_date === '') payload.discharge_date = null;
      if (payload.settlement_date === '') payload.settlement_date = null;

      await mutateAsync(payload);

      if (docFile && watchHospitalStatus === 'discharged') {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', docFile.file);
        formData.append('patient_id', patient.id);
        formData.append('doc_type', 'discharge_summary');
        await documentApi.upload(formData);
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

  const isPCC = user?.role === 'pcc';

  return (
    <Modal open={open} onClose={onClose} title="Edit Patient">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
          <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            {...register('name', { required: 'Name required' })} />
          {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
        </div>

        {!isPCC && (
          <>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Hospital Status</label>
              <select className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                {...register('hospital_status')}>
                <option value="active">Active (Admitted)</option>
                <option value="discharged">Discharged</option>
              </select>
            </div>

            {watchHospitalStatus === 'discharged' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Discharge Date & Time</label>
                  <input type="datetime-local" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    {...register('discharge_date', {
                      validate: (value) => {
                        if (!value) return true;
                        const selected = new Date(value);
                        const admission = patient.admission_date ? new Date(patient.admission_date) : null;
                        if (admission && selected < admission) {
                          return 'Discharge date cannot be before admission';
                        }
                        return true;
                      }
                    })} />
                  <p className="text-xs text-gray-500 mt-1">Leave blank to use the current date/time automatically.</p>
                  {errors.discharge_date && <p className="text-xs text-red-500 mt-1">{errors.discharge_date.message}</p>}
                </div>
                
                <div className="space-y-1 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Upload Discharge Summary (Optional)</label>
                  <CameraFileUploader file={docFile} onChange={setDocFile} disabled={isLoading || isUploading} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Settlement Status</label>
              <select className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                {...register('settlement_status')}>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
              {watchHospitalStatus === 'active' && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                  <AlertCircle size={12} /> Patient must be discharged before completing settlement
                </p>
              )}
            </div>

            {/* Settlement Date field when status is completed */}
            {watchSettlementStatus === 'completed' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">PMJAY Settlement Date & Time</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  {...register('settlement_date')}
                />
                <p className="text-xs text-gray-500 mt-1">Leave blank to use current date/time automatically.</p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1" disabled={isLoading || isUploading}>Cancel</Button>
          <Button type="submit" loading={isLoading || isUploading} className="flex-1">
            {isUploading ? 'Uploading...' : 'Save Changes'}
          </Button>
        </div>
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

  const displayName = doc.file_name === 'blob' || doc.file_name === 'image' || !doc.file_name
    ? `${DOC_TYPE_LABELS[doc.doc_type] || 'Document'}`
    : doc.file_name;

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (!fileUrl) return;
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const ext = doc.file_name?.includes('.') ? '' : (isImage ? '.jpg' : '.pdf');
      const name = displayName.includes('.') ? displayName : `${displayName}${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
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
        {/* Hover Actions */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button onClick={(e) => { e.stopPropagation(); onView(doc); }} className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-colors">
            <Eye size={14} className="text-blue-600" />
          </button>
          {fileUrl && (
            <button onClick={handleDownload} className="p-2 bg-white rounded-full shadow-md hover:bg-green-50 transition-colors">
              <Download size={14} className="text-green-600" />
            </button>
          )}
          {canDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(doc); }} className="p-2 bg-white rounded-full shadow-md hover:bg-red-50 transition-colors">
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
        <p className="text-xs text-gray-400 truncate">by {doc.uploaded_by_name}</p>
        {doc.updated_by && (
          <p className="text-[10px] text-blue-500 font-bold truncate mt-0.5 bg-blue-50 rounded px-1 w-fit">
            Edited by {doc.updated_by_name}
          </p>
        )}
        {doc.notes && <p className="text-xs text-gray-500 mt-1.5 bg-gray-50 rounded-md px-2 py-1 truncate">{doc.notes}</p>}
        {/* Per-document download button */}
        {fileUrl && (
          <button
            onClick={handleDownload}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-100"
          >
            <Download size={12} />
            Download
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
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
    { enabled: !!id }
  );

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
        const fileUrl = doc.presigned_url
          ? (doc.presigned_url.startsWith('http') ? doc.presigned_url : `${CONST_API_URL}${doc.presigned_url}`)
          : null;

        if (!fileUrl) {
          toast.error('File not available');
          return;
        }

        const response = await fetch(fileUrl);
        const blob = await response.blob();
        const isImage = doc.mime_type?.startsWith('image/');
        const ext = doc.file_name?.includes('.') ? '' : (isImage ? '.jpg' : '.pdf');
        const displayName = doc.file_name === 'blob' || doc.file_name === 'image' || !doc.file_name
          ? `${DOC_TYPE_LABELS[doc.doc_type] || 'Document'}`
          : doc.file_name;
        const name = displayName.includes('.') ? displayName : `${displayName}${ext}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Multiple files as ZIP
        const zip = new JSZip();

        for (const doc of selectedDocObjs) {
          const fileUrl = doc.presigned_url
            ? (doc.presigned_url.startsWith('http') ? doc.presigned_url : `${CONST_API_URL}${doc.presigned_url}`)
            : null;

          if (fileUrl) {
            const response = await fetch(fileUrl);
            const blob = await response.blob();
            const isImage = doc.mime_type?.startsWith('image/');
            const ext = doc.file_name?.includes('.') ? '' : (isImage ? '.jpg' : '.pdf');
            const displayName = doc.file_name === 'blob' || doc.file_name === 'image' || !doc.file_name
              ? `${DOC_TYPE_LABELS[doc.doc_type] || 'Document'}`
              : doc.file_name;
            const name = displayName.includes('.') ? displayName : `${displayName}${ext}`;
            zip.file(name, blob);
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => navigate('/patients')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors self-start">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{patient.name}</h1>
          <p className="text-gray-400 text-sm">{patient.uhid}</p>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
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
          {patient.hospital_status === 'discharged' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Settlement:</span>
              <Badge variant={STATUS_COLORS[patient.settlement_status]}>
                {patient.settlement_status === 'completed' ? '💰' : '⏳'} {patient.settlement_status}
              </Badge>
            </div>
          )}
          <Button variant="danger" size="sm" onClick={() => setDeletePatientOpen(true)} className="w-fit self-end sm:w-auto sm:self-auto">
            <Trash2 size={13} /> <span className="sm:hidden">Delete Profile</span><span className="hidden sm:inline">Delete Patient Profile</span>
          </Button>
        </div>
      </Card>

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
        )}
      </div>

      {/* Document Viewer */}
      {viewDoc && (
        <DocumentViewerModal 
          doc={{
            ...viewDoc,
            canAction: canEdit(viewDoc.uploaded_by, viewDoc.uploader_role),
            onDelete: () => { setViewDoc(null); setDeleteDoc(viewDoc); },
            onEdit: () => { setViewDoc(null); setActionDocId(viewDoc.id); }
          }} 
          onClose={() => setViewDoc(null)} 
        />
      )}

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