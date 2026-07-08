import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from 'react-query';
import { patientApi } from '../services/api';
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, Pagination, Modal } from '../components/common';
import { Search, Plus, Users, ChevronRight, Download, X, Calendar, Filter, SlidersHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../context/AuthContext';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  document_submission: 'indigo', pending: 'amber', completed: 'green',
  none: 'gray'
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
  const [bulkSettlementStatus, setBulkSettlementStatus] = useState('none');

  const debouncedSearch = useDebounce(search, 300);

  // ── Date filters ────────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const activeDateFilters = (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const clearDateFilters = () => {
    setDateFrom('');
    setDateTo('');
  };

  const getHospitalStatus = () => {
    if (activeTab === 'active') return 'active';
    if (activeTab === 'discharged' || activeTab === 'document_submission' || activeTab === 'pending' || activeTab === 'settled') return 'discharged';
    return '';
  };

  const getSettlementStatus = () => {
    if (activeTab === 'document_submission') return 'document_submission';
    if (activeTab === 'pending') return 'pending';
    if (activeTab === 'settled') return 'completed';
    return '';
  };

  const { data, isLoading, isFetching, refetch } = useQuery(
    ['patients', debouncedSearch, activeTab, page, dateFrom, dateTo],
    () => patientApi.getAll({
      search: debouncedSearch,
      hospital_status: getHospitalStatus(),
      settlement_status: getSettlementStatus(),
      admission_date_from: dateFrom || undefined,
      admission_date_to: dateTo || undefined,
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
        settlement_status: getSettlementStatus(),
        admission_date_from: dateFrom || undefined,
        admission_date_to: dateTo || undefined,
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

  const canBulkSelect = canBulkDischarge && (activeTab === 'active' || activeTab === 'pending' || activeTab === 'discharged' || activeTab === 'document_submission');
  const selectedIds = selectedPatients.map(p => p.id);

  const showDischargeCol = activeTab === 'discharged' || activeTab === 'document_submission' || activeTab === 'pending' || activeTab === 'settled';
  const showDocSubCol = activeTab === 'document_submission' || activeTab === 'pending' || activeTab === 'settled';
  const showPendingCol = activeTab === 'pending' || activeTab === 'settled';
  const showSettlementCol = activeTab === 'settled';

  // Dynamic grid
  const gridStyle = showSettlementCol
    ? 'repeat(21, minmax(0, 1fr))'
    : showPendingCol
      ? 'repeat(20, minmax(0, 1fr))'
      : showDocSubCol
        ? 'repeat(18, minmax(0, 1fr))'
        : showDischargeCol
          ? 'repeat(16, minmax(0, 1fr))'
          : 'repeat(15, minmax(0, 1fr))';

  const patientColSpan = showDischargeCol ? 'col-span-3' : 'col-span-4';
  const uhidColSpan = showSettlementCol ? 'col-span-2' : 'col-span-3';
  const statusColSpan = 'col-span-2'; // always 2 — enough room for both badges


  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedPatients(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const selectablePatients = activeTab === 'discharged' 
          ? patients.filter(p => p.settlement_status === 'none')
          : activeTab === 'document_submission'
            ? patients.filter(p => p.settlement_status === 'document_submission')
            : patients;
        const toAdd = selectablePatients.filter(p => !existingIds.has(p.id));
        return [...prev, ...toAdd];
      });
    } else {
      const currentPageIds = new Set(patients.map(p => p.id));
      setSelectedPatients(prev => prev.filter(p => !currentPageIds.has(p.id)));
    }
  };

  const handleSelectOne = (patient) => {
    // Prevent selecting unselectable patients
    if (activeTab === 'discharged' && patient.settlement_status !== 'none') return;
    if (activeTab === 'document_submission' && patient.settlement_status !== 'document_submission') return;
    
    setSelectedPatients(prev =>
      prev.some(p => p.id === patient.id)
        ? prev.filter(p => p.id !== patient.id)
        : [...prev, patient]
    );
  };

  const openPreviewModal = () => {
    setBulkDate(localNow());
    setBulkSettlementStatus(
      activeTab === 'active' ? 'none' : 
      activeTab === 'discharged' ? 'document_submission' : 
      activeTab === 'document_submission' ? 'pending' : 
      activeTab === 'pending' ? 'completed' : 'none'
    );
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
        actionData.settlement_status = 'none';
      } else if (activeTab === 'discharged') {
        actionData.settlement_status = 'document_submission';
        actionData.document_submission_date = isoDate;
      } else if (activeTab === 'document_submission') {
        actionData.settlement_status = 'pending';
        actionData.pending_date = isoDate;
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
    { id: 'document_submission', label: 'Document Submission' },
    { id: 'pending', label: 'PMJAY Pending' },
    { id: 'settled', label: 'PMJAY Settled' },
  ];

  const hasFilters = search || activeTab !== 'all' || dateFrom || dateTo;

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
                <span className="hidden sm:inline">
                  {activeTab === 'active' ? `Discharge Selected (${selectedPatients.length})` : 
                   activeTab === 'discharged' ? `Document Submission Selected (${selectedPatients.length})` :
                   activeTab === 'document_submission' ? `Mark Pending Selected (${selectedPatients.length})` :
                   activeTab === 'pending' ? `Settle Selected (${selectedPatients.length})` :
                   `Action Selected (${selectedPatients.length})`}
                </span>
                <span className="sm:hidden">
                  {activeTab === 'active' ? `Discharge (${selectedPatients.length})` : 
                   activeTab === 'discharged' ? `Doc Sub (${selectedPatients.length})` :
                   activeTab === 'document_submission' ? `Pending (${selectedPatients.length})` :
                   activeTab === 'pending' ? `Settle (${selectedPatients.length})` :
                   `Action (${selectedPatients.length})`}
                </span>
              </Button>
            </>
          )}
          {!['pcc', 'nursing'].includes(user?.role) && (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isExporting ? <Spinner size="sm" /> : <Download size={13} />}
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          )}
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

      {/* Search + Date Filter */}
      <Card>
        {/* Search Row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by IP, UHID or name..."
              className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none hover:border-gray-300 transition-all"
            />
          </div>

          {/* Filter toggle button */}
          <button
            type="button"
            onClick={() => setFilterOpen(o => !o)}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
              filterOpen || activeDateFilters > 0
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">Filters</span>
            {activeDateFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center shadow">
                {activeDateFilters}
              </span>
            )}
          </button>
        </div>

        {/* Date filter panel — collapsible */}
        {filterOpen && (
          <div className="mt-3 pt-3 border-t border-gray-100 animate-fade-in">
            <div className="flex flex-wrap items-end gap-3">
              {/* Label */}
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full sm:w-auto">
                <Calendar size={13} />
                Admission Date Range
              </div>

              {/* From */}
              <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-gray-300 transition-all bg-white"
                />
              </div>

              {/* To */}
              <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">To</label>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-gray-300 transition-all bg-white"
                />
              </div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: 'Today', days: 0 },
                  { label: 'Last 7d', days: 7 },
                  { label: 'Last 30d', days: 30 },
                  { label: 'Last 90d', days: 90 },
                ].map(({ label, days }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      const from = new Date();
                      from.setDate(today.getDate() - days);
                      const fmt = (d) => d.toISOString().split('T')[0];
                      setDateFrom(fmt(from));
                      setDateTo(fmt(today));
                      setPage(1);
                    }}
                    className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 bg-gray-50 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-all"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Clear */}
              {activeDateFilters > 0 && (
                <button
                  type="button"
                  onClick={clearDateFilters}
                  className="flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 rounded-lg transition-colors"
                >
                  <X size={12} />
                  Clear dates
                </button>
              )}
            </div>

            {/* Active filter summary */}
            {activeDateFilters > 0 && (
              <div className="mt-2.5 flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <Calendar size={12} />
                <span>
                  Showing admissions
                  {dateFrom && <> from <strong>{format(new Date(dateFrom), 'dd MMM yyyy')}</strong></>}
                  {dateTo && <> to <strong>{format(new Date(dateTo), 'dd MMM yyyy')}</strong></>}
                </span>
              </div>
            )}
          </div>
        )}
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
            <div className="overflow-x-auto w-full rounded-t-xl">
              <div className="min-w-[1000px]">
                {/* Table Header - Desktop */}
                <div
                  className="grid gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-t-xl"
              style={{ gridTemplateColumns: gridStyle }}
            >
              <div className={`${patientColSpan} flex items-center gap-2`}>
                {canBulkSelect && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-1 cursor-pointer"
                    checked={patients.length > 0 && (() => {
                      const selectable = activeTab === 'discharged' 
                        ? patients.filter(p => p.settlement_status === 'none') 
                        : activeTab === 'document_submission'
                          ? patients.filter(p => p.settlement_status === 'document_submission')
                          : patients;
                      return selectable.length > 0 && selectable.every(p => selectedIds.includes(p.id));
                    })()}
                    ref={el => {
                      if (el) {
                        const selectable = activeTab === 'discharged' 
                          ? patients.filter(p => p.settlement_status === 'none') 
                          : activeTab === 'document_submission'
                            ? patients.filter(p => p.settlement_status === 'document_submission')
                            : patients;
                        const someSelected = selectable.some(p => selectedIds.includes(p.id));
                        const allSelected = selectable.length > 0 && selectable.every(p => selectedIds.includes(p.id));
                        el.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    onChange={handleSelectAll}
                  />
                )}
                Patient
              </div>
              <div className="col-span-2">IP No</div>
              <div className={uhidColSpan}>UHID/REG No</div>
              <div className="col-span-2">Admitted</div>
              {showDischargeCol && <div className="col-span-2">Discharged</div>}
              {showDocSubCol && <div className="col-span-2">Submitted</div>}
              {showPendingCol && <div className="col-span-2">Pending</div>}
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
                  className={`grid gap-3 items-center px-5 py-4 transition-colors group border-l-2 ${
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
                        className={`flex items-center p-1 rounded ${
                          ((activeTab === 'discharged' && patient.settlement_status !== 'none') ||
                           (activeTab === 'document_submission' && patient.settlement_status !== 'document_submission'))
                            ? 'opacity-0 pointer-events-none' 
                            : 'hover:bg-gray-200'
                        }`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (activeTab === 'discharged' && patient.settlement_status !== 'none') return;
                          if (activeTab === 'document_submission' && patient.settlement_status !== 'document_submission') return;
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
                      
                    </div>
                  </div>

                  {/* IP No */}
                  <div className="flex col-span-2 items-center pr-2">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 break-words max-w-full">{patient.ip_number || '-'}</span>
                  </div>

                  {/* UHID */}
                  <div className={`flex ${uhidColSpan} items-center`}>
                    <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{patient.uhid}</span>
                  </div>

                  {/* Admitted Date — shown in ALL tabs */}
                  <div className="flex col-span-2 flex-col justify-center">
                    <span className="text-xs font-semibold text-gray-700">{fmtDate(patient.admission_date)}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">{format(new Date(patient.created_at), 'hh:mm a')}</span>
                  </div>

                  {/* Discharge Date (shown in discharged / pending / settled tabs) */}
                  {showDischargeCol && (
                    <div className="flex col-span-2 flex-col justify-center">
                      {patient.hospital_status === 'discharged' && patient.discharge_date ? (
                        <>
                          <span className="text-xs font-semibold text-purple-700">{fmtDate(patient.discharge_date)}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(patient.discharge_date)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  )}

                  {/* Document Submission Date */}
                  {showDocSubCol && (
                    <div className="flex col-span-2 flex-col justify-center">
                      {patient.settlement_status !== 'none' && patient.document_submission_date ? (
                        <>
                          <span className="text-xs font-semibold text-indigo-700">{fmtDate(patient.document_submission_date)}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(patient.document_submission_date)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  )}

                  {/* Pending Date (shown in pending / settled tabs) */}
                  {showPendingCol && (
                    <div className="flex col-span-2 flex-col justify-center">
                      {(patient.settlement_status === 'pending' || patient.settlement_status === 'completed') && patient.pending_date ? (
                        <>
                          <span className="text-xs font-semibold text-amber-700">{fmtDate(patient.pending_date)}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(patient.pending_date)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  )}

                  {/* Settlement Date (shown only in settled tab) */}
                  {showSettlementCol && (
                    <div className="flex col-span-2 flex-col justify-center">
                      {patient.settlement_status === 'completed' && patient.settlement_date ? (
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
                  <div className={`flex ${statusColSpan} flex-col gap-1 items-start`}>
                    <Badge variant={STATUS_COLORS[patient.hospital_status]}>{patient.hospital_status}</Badge>
                    {patient.hospital_status === 'discharged' && patient.settlement_status && patient.settlement_status !== 'none' && (
                      <Badge variant={STATUS_COLORS[patient.settlement_status]} size="xs">
                        {patient.settlement_status === 'document_submission' ? 'doc submission' : patient.settlement_status}
                      </Badge>
                    )}
                  </div>

                  {/* Doc count */}
                  <div className="flex col-span-1 items-center">
                    <span className="text-xs text-gray-500 font-medium">{patient.document_count}</span>
                  </div>

                  {/* Arrow */}
                  <div className="col-span-1 flex justify-end">
                    
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
              </div>
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
      <Modal 
        open={showPreviewModal} 
        onClose={() => setShowPreviewModal(false)} 
        title="Confirm Bulk Action" 
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3 w-full">
            <Button variant="secondary" onClick={() => setShowPreviewModal(false)} className="flex-1">Cancel</Button>
            <Button variant="success" onClick={executeBulkAction} loading={isBulkUpdating} className="flex-1">
              Confirm & {activeTab === 'active' ? 'Discharge' : 
                         activeTab === 'discharged' ? 'Submit Documents' : 
                         activeTab === 'document_submission' ? 'Mark Pending' : 
                         'Settle'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            You are about to <strong>
              {activeTab === 'active' ? 'Discharge' : 
               activeTab === 'discharged' ? 'Submit Documents for' : 
               activeTab === 'document_submission' ? 'Mark as PMJAY Pending for' : 
               'Settle PMJAY for'}
            </strong> the following {selectedPatients.length} patient{selectedPatients.length !== 1 && 's'}:
          </p>

          {/* Date & Time picker */}
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-1">
            <label className="block text-xs font-semibold text-blue-700 uppercase tracking-wide">
              {activeTab === 'active' ? 'Discharge Date & Time' : 
               activeTab === 'discharged' ? 'Submission Date & Time' : 
               activeTab === 'document_submission' ? 'Pending Date & Time' : 
               'Settlement Date & Time'}
            </label>
            <input
              type="datetime-local"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
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
        </div>
      </Modal>
    </div>
  );
}
