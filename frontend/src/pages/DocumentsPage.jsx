import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useLocation, Link } from 'react-router-dom';
import { documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, Spinner, EmptyState, Pagination, Button } from '../components/common';
import { 
  FileText, Search, Filter, Download, Trash2, Edit2, 
  Eye, User, Calendar, ExternalLink, MoreVertical, File
} from 'lucide-react';
import { format } from 'date-fns';
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from '../components/documents/constants';
import DocumentViewerModal from '../components/documents/DocumentViewerModal';
import DocumentActionModal from '../components/documents/DocumentActionModal';
import { useDebounce } from '../hooks/useDebounce';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import ReactSelect from 'react-select';
import * as offlineQueue from '../services/offlineQueue';
import { useOfflineSync } from '../hooks/useOfflineSync';

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function DocumentsPage() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isTodayOnly = queryParams.get('today') === 'true';
  const { user, canEdit } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  const { retryAll, refreshCount } = useOfflineSync();
  const [offlineDocs, setOfflineDocs] = useState([]);
  const [previewOfflineUrl, setPreviewOfflineUrl] = useState(null);

  const loadOfflineDocs = async () => {
    try {
      const all = await offlineQueue.getAll();
      setOfflineDocs(all || []);
    } catch {
      setOfflineDocs([]);
    }
  };

  useEffect(() => {
    loadOfflineDocs();
    const handler = () => loadOfflineDocs();
    window.addEventListener('offline-sync-complete', handler);
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    const interval = setInterval(loadOfflineDocs, 3000);
    return () => {
      window.removeEventListener('offline-sync-complete', handler);
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
      clearInterval(interval);
    };
  }, []);
  
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isFetching } = useQuery(
    ['documents', 'all', page, debouncedSearch, docTypeFilter, isTodayOnly],
    () => documentApi.getAll({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
      doc_type: docTypeFilter || undefined,
      today: isTodayOnly ? 'true' : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined
    }),
    { keepPreviousData: true }
  );

  const documents = data?.data || [];
  const pagination = data?.pagination;

  const handleDownload = async (doc) => {
    if (!doc.presigned_url) {
      toast.error('File not available');
      return;
    }
    
    const a = document.createElement('a');
    a.href = doc.download_url || doc.presigned_url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isTodayOnly ? "Today's Uploads" : "All Documents"}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {pagination?.total ?? 0} total documents found
            {isFetching && !isLoading && <span className="ml-2 text-blue-400">Updating...</span>}
          </p>
        </div>
        {isTodayOnly && (
          <Link to="/documents">
            <Button variant="secondary" size="sm">View All History</Button>
          </Link>
        )}
      </div>

      {/* Offline Drafts & Queued Uploads Section */}
      {offlineDocs.length > 0 && (
        <Card className="border-2 border-amber-300 bg-amber-50/70 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-amber-200/60 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
                <File size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-amber-950">
                  Browser Drafts & Queued Uploads ({offlineDocs.length})
                </h2>
                <p className="text-xs text-amber-800">
                  {!navigator.onLine 
                    ? "Currently offline — these documents will automatically sync once internet connection returns." 
                    : "Stored locally in your browser. Auto-syncing when connection is stable or you retry manually."}
                </p>
              </div>
            </div>
            {navigator.onLine && (
              <Button 
                size="sm" 
                onClick={async () => { await retryAll(); loadOfflineDocs(); }}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5"
              >
                Sync All Now
              </Button>
            )}
          </div>

          <div className="divide-y divide-amber-200/50 bg-white rounded-xl border border-amber-200/60 overflow-hidden">
            {offlineDocs.map((doc) => (
              <div key={doc.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-amber-50/30 transition-colors">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-amber-100/80 flex items-center justify-center flex-shrink-0 text-amber-800 font-bold text-xs">
                    {doc.docType === 'pdf' ? <FileText size={16} /> : <File size={16} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-800 truncate" title={doc.fileName}>{doc.fileName}</span>
                      <span className={clsx(
                        "text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider",
                        doc.status === 'pending' && "bg-amber-100 text-amber-800 border border-amber-300",
                        doc.status === 'syncing' && "bg-blue-100 text-blue-800 border border-blue-300 animate-pulse",
                        doc.status === 'failed' && "bg-red-100 text-red-800 border border-red-300",
                        doc.status === 'draft' && "bg-purple-100 text-purple-800 border border-purple-300"
                      )}>
                        {doc.status === 'pending' ? 'Queued for Upload' : doc.status === 'syncing' ? 'Syncing...' : doc.status === 'failed' ? 'Failed (Retry)' : 'Browser Draft'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {DOC_TYPE_LABELS[doc.docType] || doc.docType} • {formatBytes(doc.fileBlob?.size || 0)}
                      {doc.patientId && doc.patientId !== 'draft' && ` • Patient ID #${doc.patientId}`}
                      {doc.notes && ` • "${doc.notes}"`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 justify-end flex-shrink-0">
                  {doc.fileBlob && (
                    <button
                      type="button"
                      onClick={() => {
                        const url = URL.createObjectURL(doc.fileBlob);
                        setPreviewOfflineUrl({ url, fileName: doc.fileName, type: doc.fileBlob.type });
                      }}
                      className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <Eye size={13} /> Preview
                    </button>
                  )}
                  {doc.status === 'failed' && navigator.onLine && (
                    <button
                      type="button"
                      onClick={async () => {
                        await offlineQueue.updateStatus(doc.id, 'pending');
                        await retryAll();
                        loadOfflineDocs();
                      }}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await offlineQueue.remove(doc.id);
                      await refreshCount();
                      loadOfflineDocs();
                      toast.success('Draft removed from browser');
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove from offline queue"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by patient name or UHID..."
              className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          
          <div className="w-full md:w-56 z-50">
            <ReactSelect 
              options={[
                { value: '', label: 'All Document Types' },
                ...Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }))
              ]}
              value={
                docTypeFilter === '' 
                  ? { value: '', label: 'All Document Types' } 
                  : { value: docTypeFilter, label: DOC_TYPE_LABELS[docTypeFilter] }
              }
              onChange={(val) => { setDocTypeFilter(val.value); setPage(1); }}
              placeholder="Search categories..."
              className="text-sm"
              styles={{
                control: (base, state) => ({
                  ...base,
                  borderColor: state.isFocused ? '#3b82f6' : '#e5e7eb',
                  borderRadius: '0.5rem',
                  minHeight: '38px',
                  boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
                  '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#d1d5db' }
                }),
                menu: (base) => ({ ...base, zIndex: 50 })
              }}
            />
          </div>

          <input 
            type="date" 
            value={startDate} 
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="w-full sm:w-auto rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            title="Start Date"
          />
          <input 
            type="date" 
            value={endDate} 
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="w-full sm:w-auto rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            title="End Date"
          />

          {(search || docTypeFilter || startDate || endDate) && (
            <button
              onClick={() => { setSearch(''); setDocTypeFilter(''); setStartDate(''); setEndDate(''); setPage(1); }}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Clear Filters
            </button>
          )}
        </div>
      </Card>

      {/* Document List */}
      <Card padding={false}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : documents.length === 0 ? (
          <EmptyState 
            icon={FileText} 
            title="No documents found" 
            description={search || docTypeFilter ? "Try adjusting your filters" : "No documents have been uploaded yet"} 
          />
        ) : (
          <>
            {/* Desktop Table Header */}
            <div className="hidden lg:grid grid-cols-12 gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <div className="col-span-3">Patient</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-3">Uploaded By</div>
              <div className="col-span-2">Date & Time</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-gray-50">
              {documents.map((doc) => (
                <div key={doc.id} className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center px-5 py-4 hover:bg-gray-50 transition-colors group">
                  
                  {/* Patient Info */}
                  <div className="lg:col-span-3 flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                      <FileText size={16} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <Link to={`/patients/${doc.patient_id}`} className="text-sm font-bold text-gray-800 hover:text-blue-600 truncate flex items-center gap-1">
                        {doc.patient_name} <ExternalLink size={12} className="text-gray-400" />
                      </Link>
                      <p className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">{doc.patient_uhid}</p>
                    </div>
                  </div>

                  {/* Doc Type */}
                  <div className="lg:col-span-2 mt-2 lg:mt-0">
                    <Badge variant={DOC_TYPE_COLORS[doc.doc_type] || 'gray'} size="xs">
                      {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                    </Badge>
                  </div>

                  {/* Uploader */}
                  <div className="lg:col-span-3 mt-2 lg:mt-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <User size={12} className="text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{doc.uploaded_by_name}</p>
                        <p className="text-[10px] text-gray-400 uppercase">{doc.uploader_role} • {formatBytes(doc.file_size)}</p>
                      </div>
                    </div>
                    {doc.updated_by && (
                      <div className="flex items-center gap-1.5 pl-8">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <p className="text-[10px] text-blue-600 font-bold truncate">Edited by {doc.updated_by_name}</p>
                      </div>
                    )}
                  </div>

                  {/* Date */}
                  <div className="lg:col-span-2 mt-2 lg:mt-0 flex flex-col">
                    <span className="text-xs font-semibold text-gray-700">{format(new Date(doc.created_at), 'dd MMM yyyy')}</span>
                    <span className="text-[10px] text-gray-400">{format(new Date(doc.created_at), 'hh:mm a')}</span>
                  </div>

                  {/* Actions */}
                  <div className="lg:col-span-2 mt-3 lg:mt-0 flex items-center justify-end gap-1">
                    <button 
                      onClick={() => setViewDoc(doc)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      title="View"
                    >
                      <Eye size={16} />
                    </button>
                    <button 
                      onClick={() => handleDownload(doc)}
                      className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
                      title="Download"
                    >
                      <Download size={16} />
                    </button>
                    <button 
                      onClick={() => setSelectedDocId(doc.id)}
                      className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
                      title="More Actions"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {pagination && (
              <div className="px-5 py-4 border-t border-gray-50">
                <Pagination pagination={pagination} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </Card>

      {/* Modals */}
      {viewDoc && (
        <DocumentViewerModal 
          doc={{
            ...viewDoc,
            canAction: canEdit(viewDoc.uploaded_by, viewDoc.uploader_role),
            onDelete: () => { setViewDoc(null); setSelectedDocId(viewDoc.id); },
            onEdit: () => { setViewDoc(null); setSelectedDocId(viewDoc.id); }
          }} 
          onClose={() => setViewDoc(null)} 
        />
      )}

      {selectedDocId && (
        <DocumentActionModal 
          docId={selectedDocId} 
          open={!!selectedDocId} 
          onClose={() => setSelectedDocId(null)} 
        />
      )}

      {previewOfflineUrl && (
        <div className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-gray-900 text-white flex items-center justify-between border-b border-gray-800">
              <div className="flex items-center gap-2 truncate">
                <FileText size={18} className="text-amber-400" />
                <span className="font-bold text-sm truncate">{previewOfflineUrl.fileName} (Offline Preview)</span>
              </div>
              <button
                onClick={() => {
                  URL.revokeObjectURL(previewOfflineUrl.url);
                  setPreviewOfflineUrl(null);
                }}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center min-h-[400px]">
              {previewOfflineUrl.type === 'application/pdf' || previewOfflineUrl.fileName?.endsWith('.pdf') ? (
                <iframe src={previewOfflineUrl.url} className="w-full h-[70vh] rounded border border-gray-300 bg-white" title="PDF Preview" />
              ) : (
                <img src={previewOfflineUrl.url} alt="Preview" className="max-w-full max-h-[70vh] object-contain rounded shadow" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
