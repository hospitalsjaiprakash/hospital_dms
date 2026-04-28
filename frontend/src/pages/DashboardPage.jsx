import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { patientApi } from '../services/api';
import { StatCard, Card, Badge, Spinner } from '../components/common';
import {
  Users, FileText, Clock, CheckCircle, UserCheck,
  TrendingUp, AlertCircle, Plus, ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const STATUS_COLORS = {
  active: 'green', discharged: 'blue',
  pending: 'amber', completed: 'green',
};

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: statsData, isLoading: statsLoading } = useQuery('stats', patientApi.getStats, { refetchInterval: 60000 });
  const { data: recentData } = useQuery(['patients', 'recent'], () => patientApi.getAll({ limit: 8, page: 1 }), { refetchInterval: 30000 });

  const stats = statsData?.data;
  const recentPatients = recentData?.data || [];

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting()}, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <Link
          to="/patients/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
        >
          <Plus size={16} />
          New Patient
        </Link>
      </div>

      {/* Stats Grid */}
      {statsLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="Total Patients" value={stats?.total_patients} icon={Users} color="blue" />
          <StatCard title="Active" value={stats?.active_patients} icon={UserCheck} color="green" />
          <StatCard title="Discharged" value={stats?.discharged_patients} icon={CheckCircle} color="purple" />
          <StatCard title="Pending Settlement" value={stats?.pending_settlement} icon={Clock} color="amber" />
          <StatCard title="Total Documents" value={stats?.total_documents} icon={FileText} color="blue" />
          <StatCard title="Today's Uploads" value={stats?.uploaded_today} icon={TrendingUp} color="green" trend="Documents today" />
        </div>
      )}

      {/* Quick Alert */}
      {stats?.pending_settlement > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{stats.pending_settlement} patients</span> have pending settlement.{' '}
            <Link to="/patients?settlement_status=pending" className="underline font-medium hover:text-amber-900">View all →</Link>
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
                  <p className="text-xs text-gray-400">{patient.uhid} · {patient.mobile}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <Badge variant={STATUS_COLORS[patient.hospital_status]}>{patient.hospital_status}</Badge>
                  <Badge variant={STATUS_COLORS[patient.settlement_status]} size="xs">{patient.settlement_status}</Badge>
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
    </div>
  );
}
