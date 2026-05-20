import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from 'react-query';
import { patientApi } from '../services/api';
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, Pagination, Modal } from '../components/common';
import { Search, Plus, Users, ChevronRight, Download } from 'lucide-react';
import { format } from 'date-fns';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../context/AuthContext';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

// Returns a datetime-local string for "now" in local time
const localNow = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

// Helper to format a date string safely
const fmtDate = (d) => d ? format(new Date(d), 'dd MMM yyyy') : '—';
const fmtTime = (d) => d ? format(new Date(d), 'hh:mm a') : '';

export default function PatientsPage() {
  const location = useLocation();
  const { user } = useAuth();
  // PCC and Nursing are NOT allowed to bulk-discharge/settle patients
  const canBulkDischarge = !['pcc', 'nursing'].includes(user?.role);
  const urlTab = new URLSearchParams(location.search).get('tab') || 'all';
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(urlTab);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkDate, setBulkDate] = useState(localNow());

  const debouncedSearch = useDebounce(search, 300);

  const getHospitalStatus = () => {
    if (activeTab === 'active') return 'active';
    if (activeTab === 'discharged' || activeTab === 'pending' || activeTab === 'settled') return 'discharged';
    return '';
  };

  const getSettlementStatus = () => {
    if (activeTab === 'pending') return 'pending';
    if (activeTab === 'settled') return 'completed';
    return '';
  };

  const { data, isLoading, isFetching, refetch } = useQuery(
    ['patients', debouncedSearch, activeTab, page],
    () => patientApi.getAll({
      search: debouncedSearch,
      hospital_status: getHospitalStatus(),
      settlement_status: getSettlementStatus(),
      page,
      limit: 20,
    }),
    { keepPreviousData: true }
  );

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const params = {
        search: debouncedSearch,
        hospital_status: getHospitalStatus(),
        settlement_status: getSettlementStatus()
      };
      const blob = await patientApi.exportExcel(params);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'patients_export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const patients = data?.data || [];
  const pagination = data?.pagination;

  const canBulkSelect = canBulkDischarge && (activeTab === 'active' || activeTab === 'pending');
  const selectedIds = selectedPatients.map(p => p.id);

  // Tab-specific column visibility flags
  const showDischargeCol = activeTab === 'discharged' || activeTab === 'pending' || activeTab === 'settled';
  const showSettlementCol = activeTab === 'settled';

  // Dynamic grid: 13 cols for all/active, 14 for discharged/pending, 16 for settled
  const gridStyle = showSettlementCol
    ? 'repeat(16, minmax(0, 1fr))'
    : showDischargeCol
      ? 'repeat(14, minmax(0, 1fr))'
      : 'repeat(13, minmax(0, 1fr))';

  const patientColSpan = showDischargeCol ? 'col-span-3' : 'col-span-4';
  const statusColSpan = 'col-span-2'; // always 2 — enough room for both badges


  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedPatients(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const toAdd = patients.filter(p => !existingIds.has(p.id));
        return [...prev, ...toAdd];
      });
    } else {
      const currentPageIds = new Set(patients.map(p => p.id));
      setSelectedPatients(prev => prev.filter(p => !currentPageIds.has(p.id)));
    }
  };

  const handleSelectOne = (patient) => {
    setSelectedPatients(prev =>
      prev.some(p => p.id === patient.id)
        ? prev.filter(p => p.id !== patient.id)
        : [...prev, patient]
    );
  };

  const openPreviewModal = () => {
    setBulkDate(localNow());
    setShowPreviewModal(true);
  };

  const executeBulkAction = async () => {
    try {
      setIsBulkUpdating(true);
      const isoDate = bulkDate ? new Date(bulkDate).toISOString() : new Date().toISOString();
      const actionData = { patientIds: selectedIds };
      if (activeTab === 'active') {
        actionData.hospital_status = 'discharged';
        actionData.discharge_date = isoDate;
      } else if (activeTab === 'pending') {
        actionData.settlement_status = 'completed';
        actionData.settlement_date = isoDate;
      }
      await patientApi.bulkUpdate(actionData);
      setSelectedPatients([]);
      setShowPreviewModal(false);
      refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const TABS = [
    { id: 'all', label: 'All Patients' },
    { id: 'active', label: 'Active (Admitted)' },
    { id: 'discharged', label: 'Discharged' },
    { id: 'pending', label: 'PMJAY Pending' },
    { id: 'settled', label: 'PMJAY Settled' },
  ];

  const hasFilters = search || activeTab !== 'all';

  // Grid column layout changes based on tab
  const headerCols = showSettlementCol
    ? 'grid-cols-12'
    : showDischargeCol
      ? 'grid-cols-12'
      : 'grid-cols-12';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Patients</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {pagination?.total ?? 0} total patients
            {isFetching && !isLoading && <span className="ml-2 text-blue-400">Updating...</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBulkDischarge && selectedPatients.length > 0 && (
            <>
              <button
                onClick={() => setSelectedPatients([])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Clear ({selectedPatients.length})
              </button>
              <Button
                variant="success"
                size="sm"
                onClick={openPreviewModal}
              >
                <span className="hidden sm:inline">{activeTab === 'active' ? `Discharge Selected (${selectedPatients.length})` : `Settle Selected (${selectedPatients.length})`}</span>
                <span className="sm:hidden">{activeTab === 'active' ? `Discharge (${selectedPatients.length})` : `Settle (${selectedPatients.length})`}</span>
              </Button>
            </>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isExporting ? <Spinner size="sm" /> : <Download size={13} />}
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          <Link to="/patients/new">
            <Button size="sm">
              <Plus size={15} />
              <span>New Patient</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(1); setSelectedPatients([]); }}
            className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by IP, UHID or name..."
            className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none hover:border-gray-300 transition-all"
          />
        </div>
      </Card>

      {/* Patient List */}
      <Card padding={false}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : patients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No patients found"
            description={hasFilters ? 'Try adjusting your search or filters' : 'Add your first patient to get started'}
            action={!hasFilters && <Link to="/patients/new"><Button><Plus size={14} /> Add Patient</Button></Link>}
          />
        ) : (
          <>
            {/* Table Header - Desktop */}
            <div
              className="hidden sm:grid gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-t-xl"
              style={{ gridTemplateColumns: gridStyle }}
            >
              <div className={`${patientColSpan} flex items-center gap-2`}>
                {canBulkSelect && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-1 cursor-pointer"
                    checked={patients.length > 0 && patients.every(p => selectedIds.includes(p.id))}
                    ref={el => {
                      if (el) {
                        const someSelected = patients.some(p => selectedIds.includes(p.id));
                        const allSelected = patients.every(p => selectedIds.includes(p.id));
                        el.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    onChange={handleSelectAll}
                  />
                )}
                Patient
              </div>
              <div className="col-span-1">IP No</div>
              <div className="col-span-2">UHID</div>
              <div className="col-span-2">Admitted</div>
              {showDischargeCol && <div className="col-span-2">Discharged</div>}
              {showSettlementCol && <div className="col-span-2">PMJAY Settled</div>}
              <div className={statusColSpan}>Status</div>
              <div className="col-span-1">Docs</div>
              <div className="col-span-1"></div>
            </div>

            <div className="divide-y divide-gray-50">
              {patients.map((patient) => (
                <Link
                  key={patient.id}
                  to={`/patients/${patient.id}`}
                  className={`flex sm:grid gap-3 items-center px-5 py-4 transition-colors group border-l-2 ${
                    selectedIds.includes(patient.id)
                      ? 'bg-green-50 border-l-green-400 hover:bg-green-100'
                      : 'border-l-transparent hover:bg-gray-50'
                  }`}
                  style={{ gridTemplateColumns: gridStyle }}
                >
                  {/* Name col */}
                  <div className={`flex items-center gap-3 flex-1 ${patientColSpan} min-w-0`}>
                    {canBulkSelect && (
                      <div
                        className="flex items-center p-1 hover:bg-gray-200 rounded"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectOne(patient);
                        }}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                          checked={selectedIds.includes(patient.id)}
                          readOnly
                        />
                      </div>
                    )}
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-700 font-bold text-xs">{patient.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-600 transition-colors">{patient.name}</p>
                      <p className="text-xs text-gray-400 sm:hidden">{patient.uhid}</p>
                    </div>
                  </div>

                  {/* IP No */}
                  <div className="hidden sm:flex sm:col-span-1 items-center">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{patient.ip_number || '-'}</span>
                  </div>

                  {/* UHID */}
                  <div className="hidden sm:flex sm:col-span-2 items-center">
                    <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{patient.uhid}</span>
                  </div>

                  {/* Admitted Date — shown in ALL tabs */}
                  <div className="hidden sm:flex sm:col-span-2 flex-col justify-center">
                    <span className="text-xs font-semibold text-gray-700">{fmtDate(patient.admission_date)}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">{format(new Date(patient.created_at), 'hh:mm a')}</span>
                  </div>

                  {/* Discharge Date (shown in discharged / pending / settled tabs) */}
                  {showDischargeCol && (
                    <div className="hidden sm:flex sm:col-span-2 flex-col justify-center">
                      {patient.discharge_date ? (
                        <>
                          <span className="text-xs font-semibold text-purple-700">{fmtDate(patient.discharge_date)}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(patient.discharge_date)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  )}

                  {/* Settlement Date (shown only in settled tab) */}
                  {showSettlementCol && (
                    <div className="hidden sm:flex sm:col-span-2 flex-col justify-center">
                      {patient.settlement_date ? (
                        <>
                          <span className="text-xs font-semibold text-green-700">{fmtDate(patient.settlement_date)}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(patient.settlement_date)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  )}

                  {/* Status */}
                  <div className={`hidden sm:flex ${statusColSpan} flex-col gap-1 items-start`}>
                    <Badge variant={STATUS_COLORS[patient.hospital_status]}>{patient.hospital_status}</Badge>
                    {patient.hospital_status === 'discharged' && (
                      <Badge variant={STATUS_COLORS[patient.settlement_status]} size="xs">{patient.settlement_status}</Badge>
                    )}
                  </div>

                  {/* Doc count */}
                  <div className="hidden sm:flex sm:col-span-1 items-center">
                    <span className="text-xs text-gray-500 font-medium">{patient.document_count}</span>
                  </div>

                  {/* Arrow */}
                  <div className="sm:col-span-1 flex justify-end">
                    <div className="flex sm:hidden flex-col gap-1 mr-3">
                      <Badge variant={STATUS_COLORS[patient.hospital_status]}>{patient.hospital_status}</Badge>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>

            {pagination && (
              <div className="px-5 py-4 border-t border-gray-50">
                <Pagination pagination={pagination} onPageChange={(p) => setPage(p)} />
              </div>
            )}
          </>
        )}
      </Card>

      {/* Bulk Action Preview Modal */}
      <Modal open={showPreviewModal} onClose={() => setShowPreviewModal(false)} title="Confirm Bulk Action" maxWidth="max-w-lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            You are about to <strong>{activeTab === 'active' ? 'Discharge' : 'Settle PMJAY for'}</strong> the following {selectedPatients.length} patient{selectedPatients.length !== 1 && 's'}:
          </p>

          {/* Date & Time picker */}
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-1">
            <label className="block text-xs font-semibold text-blue-700 uppercase tracking-wide">
              {activeTab === 'active' ? 'Discharge Date & Time' : 'Settlement Date & Time'}
            </label>
            <input
              type="datetime-local"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-blue-500">Defaults to current date & time if left unchanged.</p>
          </div>

          {/* Patient list preview */}
          <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {selectedPatients.map(p => (
              <div key={p.id} className="flex justify-between items-center text-sm px-3 py-2 hover:bg-gray-50">
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="font-mono text-gray-500 text-xs bg-gray-100 px-2 py-0.5 rounded">{p.uhid}</span>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShowPreviewModal(false)}>Cancel</Button>
            <Button variant="success" onClick={executeBulkAction} loading={isBulkUpdating}>
              Confirm & {activeTab === 'active' ? 'Discharge' : 'Settle'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
