import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from 'react-query';
import { patientApi } from '../services/api';
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, Pagination } from '../components/common';
import { Search, Plus, Users, Filter, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useDebounce } from '../hooks/useDebounce';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

export default function PatientsPage() {
  const location = useLocation();
  const urlTab = new URLSearchParams(location.search).get('tab') || 'all';
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(urlTab);
  const [page, setPage] = useState(1);

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

  const { data, isLoading, isFetching } = useQuery(
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

  const patients = data?.data || [];
  const pagination = data?.pagination;

  const TABS = [
    { id: 'all', label: 'All Patients' },
    { id: 'active', label: 'Active (Admitted)' },
    { id: 'discharged', label: 'Discharged' },
    { id: 'pending', label: 'Discharged (Pending)' },
    { id: 'settled', label: 'Discharged (Settled)' },
  ];

  const hasFilters = search || activeTab !== 'all';

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
        <Link to="/patients/new">
          <Button size="sm" className="w-full sm:w-auto">
            <Plus size={15} />
            <span className="hidden sm:inline">New Patient</span>
            <span className="sm:hidden">New Patient</span>
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(1); }}
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
            placeholder="Search by UHID or name..."
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
            <div className="hidden sm:grid grid-cols-12 gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-t-xl">
              <div className="col-span-4">Patient</div>
              <div className="col-span-2">UHID</div>
              <div className="col-span-2">Admitted</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1">Docs</div>
              <div className="col-span-1"></div>
            </div>

            <div className="divide-y divide-gray-50">
              {patients.map((patient) => (
                <Link
                  key={patient.id}
                  to={`/patients/${patient.id}`}
                  className="flex sm:grid sm:grid-cols-12 sm:gap-4 items-center px-5 py-4 hover:bg-gray-50 transition-colors group"
                >
                  {/* Name */}
                  <div className="flex items-center gap-3 flex-1 sm:col-span-4 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-700 font-bold text-xs">{patient.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-600 transition-colors">{patient.name}</p>
                      <p className="text-xs text-gray-400 sm:hidden">{patient.uhid}</p>
                    </div>
                  </div>

                  {/* UHID */}
                  <div className="hidden sm:flex sm:col-span-2 items-center">
                    <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{patient.uhid}</span>
                  </div>

                  {/* Date */}
                  <div className="hidden sm:flex sm:col-span-2 flex-col justify-center">
                    <span className="text-xs font-semibold text-gray-700">{format(new Date(patient.admission_date), 'dd MMM yyyy')}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">{format(new Date(patient.created_at), 'hh:mm a')}</span>
                  </div>

                  {/* Status */}
                  <div className="hidden sm:flex sm:col-span-2 flex-col gap-1 items-start">
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
                <Pagination pagination={pagination} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
