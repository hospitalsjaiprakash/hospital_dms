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

export default function DocumentsPage() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isTodayOnly = queryParams.get('today') === 'true';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isFetching } = useQuery(
    ['documents', 'all', page, debouncedSearch, docTypeFilter, isTodayOnly],
    () => documentApi.getAll({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
      doc_type: docTypeFilter || undefined,
      today: isTodayOnly ? 'true' : undefined
    }),
    { keepPreviousData: true }
  );

  const documents = data?.data || [];
  const pagination = data?.pagination;

  const handleDownload = (doc) => {
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

    const a = document.createElement('a');
    a.href = doc.presigned_url;
    a.download = downloadName;
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
          
          <select 
            value={docTypeFilter} 
            onChange={(e) => { setDocTypeFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[160px]"
          >
            <option value="">All Document Types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>

          {(search || docTypeFilter) && (
            <button
              onClick={() => { setSearch(''); setDocTypeFilter(''); setPage(1); }}
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
                  <div className="lg:col-span-3 mt-2 lg:mt-0 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                      <User size={12} className="text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{doc.uploaded_by_name}</p>
                      <p className="text-[10px] text-gray-400 uppercase">{doc.uploader_role}</p>
                    </div>
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
        <DocumentViewerModal doc={viewDoc} onClose={() => setViewDoc(null)} />
      )}

      {selectedDocId && (
        <DocumentActionModal 
          docId={selectedDocId} 
          open={!!selectedDocId} 
          onClose={() => setSelectedDocId(null)} 
        />
      )}
    </div>
  );
}
