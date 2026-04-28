import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { patientApi, documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, Button, Spinner, EmptyState, Modal } from '../components/common';
import DocumentUpload from '../components/documents/DocumentUpload';
import {
  ArrowLeft, Edit2, Upload, Download, FileText, Image,
  Trash2, Eye, Calendar, Phone, Hash, User,
  CheckCircle, Clock, Activity, AlertCircle, MoreVertical,
  File
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

const DOC_TYPE_LABELS = {
  id_proof: 'ID Proof', ayushman_card: 'Ayushman Card',
  admission_photo: 'Admission Photo', prescription: 'Prescription',
  lab_reports: 'Lab Reports', scans: 'Scans', discharge_summary: 'Discharge Summary', other: 'Other',
};

const DOC_TYPE_COLORS = {
  id_proof: 'bg-purple-50 text-purple-700 border-purple-100',
  ayushman_card: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  admission_photo: 'bg-blue-50 text-blue-700 border-blue-100',
  prescription: 'bg-green-50 text-green-700 border-green-100',
  lab_reports: 'bg-red-50 text-red-700 border-red-100',
  scans: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  discharge_summary: 'bg-teal-50 text-teal-700 border-teal-100',
  other: 'bg-gray-50 text-gray-700 border-gray-100',
};

// ── Edit Patient Modal ──────────────────────────────────────────────────────
function EditPatientModal({ patient, open, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      name: patient.name,
      mobile: patient.mobile,
      hospital_status: patient.hospital_status,
      settlement_status: patient.settlement_status,
      discharge_date: patient.discharge_date ? patient.discharge_date.split('T')[0] : '',
    }
  });

  const watchHospitalStatus = watch('hospital_status');

  const { mutate, isLoading } = useMutation(
    (data) => patientApi.update(patient.id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['patient', patient.id]);
        queryClient.invalidateQueries('patients');
        queryClient.invalidateQueries('stats');
        toast.success('Patient updated!');
        onClose();
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const isPCC = user?.role === 'pcc';

  return (
    <Modal open={open} onClose={onClose} title="Edit Patient">
      <form onSubmit={handleSubmit(mutate)} className="space-y-4">
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
          <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            {...register('name', { required: 'Name required' })} />
          {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Mobile *</label>
          <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={10}
            {...register('mobile', { required: 'Mobile required', pattern: { value: /^[6-9]\d{9}$/, message: 'Invalid mobile' } })} />
          {errors.mobile && <p className="text-xs text-red-500">{errors.mobile.message}</p>}
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
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Discharge Date</label>
                <input type="date" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  max={new Date().toISOString().split('T')[0]}
                  {...register('discharge_date')} />
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
          </>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={isLoading} className="flex-1">Save Changes</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Document Card ──────────────────────────────────────────────────────────
function DocumentCard({ doc, onDelete, canDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isImage = doc.mime_type?.startsWith('image/');

  const handleView = () => {
    if (doc.presigned_url) window.open(doc.presigned_url, '_blank');
    else toast.error('URL expired. Refresh page.');
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden hover:shadow-card-hover transition-shadow group">
      {/* Thumbnail */}
      <div className="h-32 bg-gray-50 flex items-center justify-center relative overflow-hidden">
        {isImage && doc.presigned_url ? (
          <img src={doc.presigned_url} alt={doc.file_name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-red-500" />
            </div>
            <span className="text-xs text-gray-400 font-medium">PDF</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button onClick={handleView} className="p-2 bg-white rounded-full shadow-md hover:bg-gray-50 transition-colors">
            <Eye size={14} className="text-gray-700" />
          </button>
          {canDelete && (
            <button onClick={() => onDelete(doc)} className="p-2 bg-white rounded-full shadow-md hover:bg-red-50 transition-colors">
              <Trash2 size={14} className="text-red-500" />
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full border', DOC_TYPE_COLORS[doc.doc_type])}>
          {DOC_TYPE_LABELS[doc.doc_type]}
        </span>
        <p className="text-xs text-gray-500 mt-2 truncate">{doc.file_name}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {format(new Date(doc.created_at), 'dd MMM yyyy, hh:mm a')}
        </p>
        <p className="text-xs text-gray-400 truncate">by {doc.uploaded_by_name}</p>
        {doc.notes && <p className="text-xs text-gray-500 mt-1.5 bg-gray-50 rounded-md px-2 py-1 truncate">{doc.notes}</p>}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit, user } = useAuth();
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState(null);
  const [activeDocType, setActiveDocType] = useState('all');
  const [docPage, setDocPage] = useState(1);

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
        queryClient.invalidateQueries(['patient', id]);
        queryClient.invalidateQueries('stats');
        toast.success('Document deleted');
        setDeleteDoc(null);
      },
      onError: (err) => toast.error(err.message),
    }
  );

  const handleExport = async () => {
    try {
      toast.loading('Preparing ZIP download...');
      const blob = await documentApi.exportZip(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${patient.uhid}_documents.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.dismiss();
      toast.success('Download started!');
    } catch (err) {
      toast.dismiss();
      toast.error(err.message || 'Export failed');
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

  // Group doc counts by type
  const docTypeCounts = docs.reduce((acc, d) => {
    acc[d.doc_type] = (acc[d.doc_type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back + Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/patients')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{patient.name}</h1>
          <p className="text-gray-400 text-sm">{patient.uhid}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Edit2 size={13} /> Edit
          </Button>
          {docs.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download size={13} /> Export ZIP
            </Button>
          )}
          {canUpload && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload size={13} /> Upload Doc
            </Button>
          )}
        </div>
      </div>

      {/* Patient Info Card */}
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Phone size={14} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Mobile</p>
              <p className="text-sm font-semibold text-gray-800">{patient.mobile}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar size={14} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Admitted</p>
              <p className="text-sm font-semibold text-gray-800">{format(new Date(patient.admission_date), 'dd MMM yyyy')}</p>
            </div>
          </div>

          {patient.discharge_date && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle size={14} className="text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Discharged</p>
                <p className="text-sm font-semibold text-gray-800">{format(new Date(patient.discharge_date), 'dd MMM yyyy')}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <File size={14} className="text-gray-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Documents</p>
              <p className="text-sm font-semibold text-gray-800">{docsPagination?.total ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Hospital:</span>
            <Badge variant={STATUS_COLORS[patient.hospital_status]}>
              {patient.hospital_status === 'active' ? '🟢' : '🔵'} {patient.hospital_status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Settlement:</span>
            <Badge variant={STATUS_COLORS[patient.settlement_status]}>
              {patient.settlement_status === 'pending' ? '⏳' : '✅'} {patient.settlement_status}
            </Badge>
          </div>
          {patient.settlement_status === 'completed' && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              Document upload locked (settlement completed)
            </span>
          )}
        </div>

        {patient.notes && (
          <p className="text-sm text-gray-600 mt-3 pt-3 border-t border-gray-50">{patient.notes}</p>
        )}
      </Card>

      {/* Documents Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">Documents</h2>
          {canUpload && (
            <button onClick={() => setUploadOpen(true)} className="text-blue-600 text-sm font-medium hover:underline flex items-center gap-1">
              <Upload size={13} /> Upload new
            </button>
          )}
        </div>

        {/* Doc Type Filter Tabs */}
        <div className="flex gap-2 flex-wrap mb-4">
          {['all', ...Object.keys(DOC_TYPE_LABELS)].map((type) => (
            <button
              key={type}
              onClick={() => { setActiveDocType(type); setDocPage(1); }}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                activeDocType === type
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              )}
            >
              {type === 'all' ? `All (${docsPagination?.total ?? 0})` : DOC_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        {docsLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents"
            description={activeDocType === 'all' ? 'Upload the first document for this patient' : `No ${DOC_TYPE_LABELS[activeDocType]} documents yet`}
            action={canUpload && <Button onClick={() => setUploadOpen(true)}><Upload size={14} /> Upload Document</Button>}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {docs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  canDelete={canEdit(doc.uploaded_by, doc.uploader_role)}
                  onDelete={setDeleteDoc}
                />
              ))}
            </div>

            {docsPagination && docsPagination.totalPages > 1 && (
              <div className="mt-4 flex justify-center gap-2">
                <button
                  disabled={!docsPagination.hasPrevPage}
                  onClick={() => setDocPage(p => p - 1)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >Prev</button>
                <span className="px-4 py-2 text-sm text-gray-600">{docPage} / {docsPagination.totalPages}</span>
                <button
                  disabled={!docsPagination.hasNextPage}
                  onClick={() => setDocPage(p => p + 1)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {uploadOpen && (
        <DocumentUpload patientId={id} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      )}

      {editOpen && patient && (
        <EditPatientModal patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
      )}

      {/* Delete Confirm Modal */}
      <Modal open={!!deleteDoc} onClose={() => setDeleteDoc(null)} title="Delete Document" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Delete this document?</p>
              <p className="text-xs text-red-600 mt-1">{deleteDoc?.file_name}</p>
              <p className="text-xs text-red-500 mt-1">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setDeleteDoc(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => deleteDocument(deleteDoc.id)} className="flex-1">
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
