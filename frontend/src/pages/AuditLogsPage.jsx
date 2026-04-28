import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { auditApi } from '../services/api';
import { Card, Badge, Spinner, EmptyState, Pagination } from '../components/common';
import { ClipboardList, Search, Filter, LogIn, Upload, Trash2, Edit2, Download, User, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const ACTION_META = {
  login: { icon: LogIn, color: 'green', label: 'Login' },
  login_failed: { icon: LogIn, color: 'red', label: 'Login Failed' },
  logout: { icon: LogIn, color: 'gray', label: 'Logout' },
  document_upload: { icon: Upload, color: 'blue', label: 'Doc Upload' },
  document_delete: { icon: Trash2, color: 'red', label: 'Doc Delete' },
  document_update: { icon: Edit2, color: 'amber', label: 'Doc Edit' },
  document_view: { icon: Filter, color: 'gray', label: 'Doc View' },
  document_download: { icon: Download, color: 'purple', label: 'Download' },
  patient_create: { icon: User, color: 'green', label: 'Patient Created' },
  patient_update: { icon: Edit2, color: 'amber', label: 'Patient Updated' },
  export_zip: { icon: Download, color: 'purple', label: 'ZIP Export' },
  user_create: { icon: UserPlus, color: 'green', label: 'User Created' },
  user_update: { icon: Edit2, color: 'amber', label: 'User Updated' },
};

const ROLE_COLORS = { admin: 'red', hod: 'purple', pcc: 'blue' };

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery(
    ['audit-logs', page, actionFilter, entityFilter],
    () => auditApi.getLogs({
      page, limit: 20,
      action: actionFilter || undefined,
      entity_type: entityFilter || undefined,
    }),
    { keepPreviousData: true }
  );

  const logs = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-gray-400 text-sm mt-0.5">Immutable record of all system activities</p>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3">
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">All Actions</option>
            {Object.entries(ACTION_META).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>

          <select value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">All Entities</option>
            <option value="auth">Auth</option>
            <option value="patient">Patient</option>
            <option value="document">Document</option>
            <option value="user">User</option>
          </select>

          {(actionFilter || entityFilter) && (
            <button
              onClick={() => { setActionFilter(''); setEntityFilter(''); setPage(1); }}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto text-sm text-gray-400 self-center">
            {pagination?.total ?? 0} total entries
          </span>
        </div>
      </Card>

      {/* Log Table */}
      <Card padding={false}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No audit logs" description="Activity will appear here" />
        ) : (
          <>
            {/* Header */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <div className="col-span-2">Action</div>
              <div className="col-span-3">User</div>
              <div className="col-span-2">Entity</div>
              <div className="col-span-3">Details</div>
              <div className="col-span-2">Time</div>
            </div>

            <div className="divide-y divide-gray-50">
              {logs.map((log) => {
                const meta = ACTION_META[log.action] || { icon: Filter, color: 'gray', label: log.action };
                const IconComp = meta.icon;
                const colorMap = {
                  green: 'bg-green-50 text-green-600',
                  red: 'bg-red-50 text-red-600',
                  blue: 'bg-blue-50 text-blue-600',
                  amber: 'bg-amber-50 text-amber-600',
                  purple: 'bg-purple-50 text-purple-600',
                  gray: 'bg-gray-50 text-gray-500',
                };

                return (
                  <div key={log.id} className="flex sm:grid sm:grid-cols-12 sm:gap-3 items-center px-5 py-3.5 hover:bg-gray-50 transition-colors">
                    {/* Action */}
                    <div className="sm:col-span-2 flex items-center gap-2 flex-shrink-0">
                      <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', colorMap[meta.color])}>
                        <IconComp size={13} />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 hidden sm:block">{meta.label}</span>
                    </div>

                    {/* User */}
                    <div className="sm:col-span-3 flex-1 sm:flex-none min-w-0 ml-3 sm:ml-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {log.user_name || log.user_email || 'System'}
                      </p>
                      {log.user_role && (
                        <Badge variant={ROLE_COLORS[log.user_role] || 'gray'} size="xs">{log.user_role}</Badge>
                      )}
                    </div>

                    {/* Entity */}
                    <div className="hidden sm:flex sm:col-span-2 items-center">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md font-mono capitalize">
                        {log.entity_type}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="hidden sm:flex sm:col-span-3 items-center">
                      {log.new_values && (
                        <span className="text-xs text-gray-500 truncate max-w-full">
                          {typeof log.new_values === 'object'
                            ? Object.entries(log.new_values).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ')
                            : JSON.stringify(log.new_values).substring(0, 60)}
                        </span>
                      )}
                      {log.ip_address && !log.new_values && (
                        <span className="text-xs text-gray-400 font-mono">{log.ip_address}</span>
                      )}
                    </div>

                    {/* Time */}
                    <div className="sm:col-span-2 flex-shrink-0 text-right sm:text-left ml-3 sm:ml-0">
                      <p className="text-xs text-gray-500">{format(new Date(log.created_at), 'dd MMM yyyy')}</p>
                      <p className="text-xs text-gray-400">{format(new Date(log.created_at), 'hh:mm:ss a')}</p>
                    </div>
                  </div>
                );
              })}
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
