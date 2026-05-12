import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { patientApi } from '../services/api';
import { StatCard, Card, Badge, Spinner, Modal } from '../components/common';
import {
  Users, FileText, Clock, CheckCircle, UserCheck,
  TrendingUp, AlertCircle, Plus, ChevronRight, BadgeCheck,
  BarChart2, X
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

const MONTH_COLORS = [
  '#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e',
  '#f97316','#eab308','#22c55e','#14b8a6','#06b6d4','#0ea5e9',
];

function CustomTooltip({ active, payload, label, unit = 'uploads' }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl">
        <p className="font-semibold">{label}</p>
        <p className="text-blue-300">{payload[0].value} {unit}</p>
      </div>
    );
  }
  return null;
}

function HourlyChart({ data }) {
  const max = Math.max(...data.map(d => d.count), 1);
  // Show only even hours on X axis to avoid crowding
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barSize={8}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval={3}
          tickFormatter={v => v.split(':')[0]}
        />
        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<CustomTooltip unit="uploads" />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.count === max && max > 0 ? '#3b82f6' : '#bfdbfe'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function MonthlyChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={22}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<CustomTooltip unit="uploads" />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={MONTH_COLORS[i % MONTH_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function YearlyChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={36}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<CustomTooltip unit="uploads" />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="count" radius={[5, 5, 0, 0]} fill="#6366f1" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: statsData, isLoading: statsLoading } = useQuery('stats', patientApi.getStats, { refetchInterval: 60000 });
  const { data: recentData } = useQuery(['patients', 'recent'], () => patientApi.getAll({ limit: 8, page: 1 }), { refetchInterval: 30000 });
  const { data: historyData, isLoading: historyLoading } = useQuery(
    'uploadHistory',
    patientApi.getUploadHistory,
    { refetchInterval: 60000 }
  );

  const stats = statsData?.data;
  const recentPatients = recentData?.data || [];
  const history = historyData?.data;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting()}, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <Link
          to="/patients/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors self-start sm:self-auto"
        >
          <Plus size={16} />
          New Patient
        </Link>
      </div>

      {/* Stats Grid */}
      {statsLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
          <Link to="/patients" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="Total Patients" value={stats?.total_patients} icon={Users} color="blue" className="h-full" />
          </Link>
          <Link to="/patients?tab=active" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="Active" value={stats?.active_patients} icon={UserCheck} color="green" className="h-full" />
          </Link>
          <Link to="/patients?tab=discharged" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="Discharged" value={stats?.discharged_patients} icon={CheckCircle} color="purple" className="h-full" />
          </Link>
          <Link to="/patients?tab=pending" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="PMJAY Pending" value={stats?.pending_settlement} icon={Clock} color="red" className="h-full" />
          </Link>
          <Link to="/patients?tab=settled" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="PMJAY Settled" value={stats?.completed_settlement} icon={BadgeCheck} color="green" className="h-full" />
          </Link>
          <Link to="/documents" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="Documents" value={stats?.total_documents} icon={FileText} color="blue" className="h-full" />
          </Link>
          <Link to="/documents?today=true" className="block transition-transform hover:scale-[1.02] active:scale-[0.98] h-full">
            <StatCard title="Today's Uploads" value={stats?.uploaded_today} icon={TrendingUp} color="green" trend="Today" className="h-full" />
          </Link>
        </div>
      )}

      {/* Today's Upload Chart — Admin & HOD only */}
      {['admin', 'hod'].includes(user?.role) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                <BarChart2 size={16} className="text-blue-500" />
                Today's Upload Activity
              </h2>
              <p className="text-gray-400 text-xs mt-0.5">Hourly document uploads — {format(new Date(), 'dd MMM yyyy')}</p>
            </div>
            <button
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg transition-colors"
            >
              <BarChart2 size={13} />
              View All History
            </button>
          </div>

          {historyLoading ? (
            <div className="flex justify-center py-8"><Spinner size="sm" /></div>
          ) : history?.hourly ? (
            <HourlyChart data={history.hourly} />
          ) : (
            <div className="py-8 text-center text-gray-400 text-xs">No upload data yet today</div>
          )}
        </Card>
      )}

      {/* Quick Alert */}
      {stats?.pending_settlement > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800">
            <span className="font-semibold">{stats.pending_settlement} patients</span> have pending settlement.{' '}
            <Link to="/patients?tab=pending" className="underline font-medium hover:text-red-900">View all →</Link>
          </p>
        </div>
      )}

      {/* Recent Patients */}
      <Card padding={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="font-bold text-gray-800 text-sm">Recent Patients</h2>
          <Link to="/patients" className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1">
            View all <ChevronRight size={12} />
          </Link>
        </div>

        {recentPatients.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No patients yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentPatients.map((patient) => (
              <Link
                key={patient.id}
                to={`/patients/${patient.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group"
              >
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-700 font-bold text-xs">{patient.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-600 transition-colors">
                    {patient.name}
                  </p>
                  <p className="text-xs text-gray-400">{patient.uhid}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <Badge variant={STATUS_COLORS[patient.hospital_status]}>{patient.hospital_status}</Badge>
                  {patient.hospital_status === 'discharged' && (
                    <Badge variant={STATUS_COLORS[patient.settlement_status]} size="xs">{patient.settlement_status}</Badge>
                  )}
                </div>
                <div className="text-right flex-shrink-0 hidden sm:block">
                  <p className="text-xs text-gray-400">{format(new Date(patient.admission_date), 'dd MMM yyyy')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{patient.document_count} docs</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Upload History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHistoryOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>
                <h2 className="font-bold text-gray-800 text-base flex items-center gap-2">
                  <BarChart2 size={18} className="text-blue-500" />
                  Upload History
                </h2>
                <p className="text-gray-400 text-xs mt-0.5">Monthly & yearly document upload trends</p>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {historyLoading ? (
                <div className="flex justify-center py-12"><Spinner /></div>
              ) : (
                <>
                  {/* Monthly Chart */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-700 text-sm">Monthly — {new Date().getFullYear()}</h3>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
                        Total: {history?.monthly?.reduce((s, d) => s + d.count, 0) ?? 0} uploads
                      </span>
                    </div>
                    {history?.monthly ? (
                      <MonthlyChart data={history.monthly} />
                    ) : (
                      <p className="text-center text-gray-400 text-sm py-8">No data</p>
                    )}
                  </div>

                  <div className="border-t border-gray-100" />

                  {/* Yearly Chart */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-700 text-sm">Yearly Overview</h3>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
                        All time: {history?.yearly?.reduce((s, d) => s + d.count, 0) ?? 0} uploads
                      </span>
                    </div>
                    {history?.yearly && history.yearly.length > 0 ? (
                      <YearlyChart data={history.yearly} />
                    ) : (
                      <p className="text-center text-gray-400 text-sm py-8">No data yet</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
