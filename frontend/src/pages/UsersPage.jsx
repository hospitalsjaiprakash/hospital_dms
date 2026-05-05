import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { userApi, auditApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, Pagination, Modal } from '../components/common';
import { useForm } from 'react-hook-form';
import {
  UserPlus, Search, Shield, Users, CheckCircle,
  XCircle, Eye, EyeOff, UserCheck, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const ROLE_COLORS = { admin: 'red', hod: 'purple', pcc: 'blue' };
const ROLE_LABELS = { admin: 'Administrator', hod: 'Head of Department', pcc: 'Patient Care Coordinator' };

function AddUserModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const { mutate, isLoading } = useMutation(userApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('users');
      toast.success('User created successfully!');
      reset();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add New User">
      <form onSubmit={handleSubmit(mutate)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Dr. Jane Smith"
              {...register('name', { required: 'Name required' })} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Employee ID *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="EMP005"
              {...register('employee_id', { required: 'Employee ID required' })} />
            {errors.employee_id && <p className="text-xs text-red-500">{errors.employee_id.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Role *</label>
            <select className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              {...register('role', { required: 'Role required' })}>
              <option value="">Select role...</option>
              <option value="pcc">PCC</option>
              <option value="hod">HOD</option>
            </select>
            {errors.role && <p className="text-xs text-red-500">{errors.role.message}</p>}
          </div>

          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Department</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Admissions, General"
              {...register('department')} />
          </div>

          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Min 8 chars with upper, lower, number"
                {...register('password', { required: 'Password required', minLength: { value: 8, message: 'Min 8 chars' } })}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={isLoading} className="flex-1"><UserPlus size={14} /> Add User</Button>
        </div>
      </form>
    </Modal>
  );
}

function UserDetailsModal({ user, open, onClose }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery(
    ['user_audit_logs', user?.id, page],
    () => auditApi.getLogs({ user_id: user.id, page, limit: 10 }),
    { enabled: !!user?.id && open, keepPreviousData: true }
  );

  if (!user) return null;

  const logs = data?.data || [];
  const pagination = data?.pagination;

  return (
    <Modal open={open} onClose={onClose} title="User Details & Activity">
      <div className="space-y-6">
        <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold">Name</p>
            <p className="font-medium text-gray-900">{user.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold">Role</p>
            <Badge variant={ROLE_COLORS[user.role]}>{ROLE_LABELS[user.role]}</Badge>
          </div>
          {user.role !== 'admin' && (
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Employee ID</p>
              <p className="font-medium text-gray-900">{user.employee_id}</p>
            </div>
          )}
          {user.department && (
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Department</p>
              <p className="font-medium text-gray-900">{user.department}</p>
            </div>
          )}
          <div className="col-span-2">
            <p className="text-xs text-gray-500 uppercase font-semibold">Password</p>
            {user.plain_password ? (
              <code className="text-sm bg-white border border-gray-200 px-2 py-1 rounded mt-1 inline-block text-gray-700">{user.plain_password}</code>
            ) : (
              <p className="text-sm text-gray-400 mt-1 italic">Hidden (Not captured at signup)</p>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Shield size={16} className="text-blue-500" />
            Recent Activity Logs
          </h3>
          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-500 italic text-center py-4">No recent activity found.</p>
          ) : (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="p-3 text-sm flex justify-between items-center hover:bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-800 capitalize">{log.action.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-gray-500">{log.entity_type} {log.entity_id ? `(${log.entity_id.slice(0,8)})` : ''}</p>
                    </div>
                    <span className="text-xs text-gray-400">{format(new Date(log.created_at), 'dd MMM yy, HH:mm')}</span>
                  </div>
                ))}
              </div>
              {pagination && pagination.total_pages > 1 && (
                <div className="p-2 bg-gray-50 border-t border-gray-100">
                  <Pagination pagination={pagination} onPageChange={setPage} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}


export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [activeTab, setActiveTab] = useState('active');

  const { data, isLoading } = useQuery(
    ['users', search, roleFilter, activeTab, page],
    () => userApi.getAll({ search, role: roleFilter, status: activeTab, page, limit: 15 }),
    { keepPreviousData: true }
  );

  const { mutate: toggleStatus } = useMutation(userApi.toggleStatus, {
    onSuccess: () => {
      queryClient.invalidateQueries('users');
      toast.success('User status updated');
    },
    onError: (err) => toast.error(err.message),
  });

  const users = data?.data || [];
  const pagination = data?.pagination;

  const handleConfirmAction = () => {
    if (!confirmTarget) return;
    toggleStatus(confirmTarget.id);
    setConfirmTarget(null);
    setConfirmAction(null);
  };

  const openConfirm = (user) => {
    const action = user.is_active ? 'deactivate' : 'activate';
    setConfirmTarget(user);
    setConfirmAction(action);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-400 text-sm mt-0.5">{pagination?.total ?? 0} registered users</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAddUserOpen(true)}>
            <UserPlus size={14} /> Add User
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {[
          { id: 'active', label: 'Approved' },
          { id: 'pending', label: 'Pending' },
          { id: 'inactive', label: 'Inactive' }
        ].map((tab) => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setPage(1); }}
            className={clsx('px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap',
              activeTab === tab.id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or employee ID..."
              className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">All Roles</option>
            <option value="pcc">PCC</option>
            <option value="hod">HOD</option>
          </select>
        </div>
      </Card>

      {/* Users Table */}
      <Card padding={false}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} title="No users found" description="Add users to get started" />
        ) : (
          <>
            <div className="divide-y divide-gray-50">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setSelectedUser(u)}>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-700 font-bold text-sm">{u.name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800 truncate">{u.name}</p>
                      {!u.is_active && activeTab === 'pending' && (
                        <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">Pending</span>
                      )}
                      {!u.is_active && activeTab === 'inactive' && (
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">Inactive</span>
                      )}
                    </div>
                    {u.role !== 'admin' && <p className="text-xs text-gray-400">{u.employee_id}</p>}
                    {u.department && <p className="text-xs text-gray-400 truncate">{u.department}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={ROLE_COLORS[u.role]}>{u.role.toUpperCase()}</Badge>
                    {u.last_login && (
                      <p className="text-xs text-gray-400 hidden sm:block">Last: {format(new Date(u.last_login), 'dd MMM, HH:mm')}</p>
                    )}
                  </div>
                  {u.id !== currentUser?.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openConfirm(u); }}
                      className={clsx(
                        'p-2 rounded-lg transition-colors flex-shrink-0',
                        u.is_active ? 'text-red-400 hover:bg-red-50 hover:text-red-600' : 'text-green-500 hover:bg-green-50'
                      )}
                      title={u.is_active ? 'Deactivate' : (activeTab === 'pending' ? 'Approve' : 'Activate')}
                    >
                      {u.is_active ? <XCircle size={18} /> : <CheckCircle size={18} />}
                    </button>
                  )}
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

      <AddUserModal open={addUserOpen} onClose={() => setAddUserOpen(false)} />
      <UserDetailsModal user={selectedUser} open={!!selectedUser} onClose={() => setSelectedUser(null)} />

      <Modal
        open={!!confirmTarget}
        onClose={() => { setConfirmTarget(null); setConfirmAction(null); }}
        title={confirmAction === 'deactivate' ? 'Confirm Deactivation' : 'Confirm Action'}
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-gray-700">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div>
              <p className="font-semibold text-gray-900">{confirmAction === 'deactivate' ? 'Deactivate user' : 'Activate user'}</p>
              <p className="text-sm text-gray-500">
                {confirmAction === 'deactivate'
                  ? 'Are you sure you want to deactivate this user? They will no longer be able to sign in.'
                  : 'Are you sure you want to activate this user? They will be able to sign in again.'}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setConfirmTarget(null); setConfirmAction(null); }}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === 'deactivate' ? 'danger' : 'success'}
              className="flex-1"
              onClick={handleConfirmAction}
            >
              {confirmAction === 'deactivate' ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
