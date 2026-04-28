import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { userApi } from '../services/api';
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

          <div className="col-span-2 space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Email *</label>
            <input type="email" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="staff@hospital.com"
              {...register('email', { required: 'Email required', pattern: { value: /\S+@\S+\.\S+/, message: 'Invalid email' } })} />
            {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
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
              <option value="admin">Admin</option>
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

function AddStaffModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const { mutate, isLoading } = useMutation(userApi.addToStaffMaster, {
    onSuccess: () => {
      queryClient.invalidateQueries('staff-master');
      toast.success('Staff added to approved list!');
      reset();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add to Approved Staff List">
      <form onSubmit={handleSubmit(mutate)} className="space-y-4">
        <p className="text-sm text-gray-500 bg-blue-50 rounded-lg p-3 border border-blue-100">
          Staff added here can self-register using their email.
        </p>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name *</label>
          <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            {...register('name', { required: 'Required' })} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Work Email *</label>
          <input type="email" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            {...register('email', { required: 'Required' })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Employee ID *</label>
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              {...register('employee_id', { required: 'Required' })} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Role *</label>
            <select className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              {...register('role', { required: 'Required' })}>
              <option value="">Select...</option>
              <option value="pcc">PCC</option>
              <option value="hod">HOD</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Department</label>
          <input className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            {...register('department')} />
        </div>
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={isLoading} className="flex-1">Add to Staff List</Button>
        </div>
      </form>
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
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('users');

  const { data, isLoading } = useQuery(
    ['users', search, roleFilter, page],
    () => userApi.getAll({ search, role: roleFilter, page, limit: 15 }),
    { keepPreviousData: true }
  );

  const { data: staffData, isLoading: staffLoading } = useQuery(
    ['staff-master', page],
    () => userApi.getStaffMaster({ page, limit: 15 }),
    { enabled: activeTab === 'staff' }
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
  const staffList = staffData?.data || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-400 text-sm mt-0.5">{pagination?.total ?? 0} registered users</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAddStaffOpen(true)}>
            <UserCheck size={14} /> Add to Staff List
          </Button>
          <Button size="sm" onClick={() => setAddUserOpen(true)}>
            <UserPlus size={14} /> Add User
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {['users', 'staff'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize',
              activeTab === tab ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {tab === 'users' ? 'Registered Users' : 'Approved Staff List'}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <>
          {/* Filters */}
          <Card>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search by name, email, or employee ID..."
                  className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">All Roles</option>
                <option value="pcc">PCC</option>
                <option value="hod">HOD</option>
                <option value="admin">Admin</option>
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
                    <div key={u.id} className="flex items-center gap-4 px-5 py-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-700 font-bold text-sm">{u.name.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800 truncate">{u.name}</p>
                          {!u.is_active && (
                            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Inactive</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{u.email} · {u.employee_id}</p>
                        {u.department && <p className="text-xs text-gray-400">{u.department}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <Badge variant={ROLE_COLORS[u.role]}>{u.role.toUpperCase()}</Badge>
                        {u.last_login && (
                          <p className="text-xs text-gray-400">Last: {format(new Date(u.last_login), 'dd MMM, HH:mm')}</p>
                        )}
                      </div>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => toggleStatus(u.id)}
                          className={clsx(
                            'p-2 rounded-lg transition-colors flex-shrink-0',
                            u.is_active ? 'text-red-400 hover:bg-red-50 hover:text-red-600' : 'text-green-500 hover:bg-green-50'
                          )}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {u.is_active ? <XCircle size={16} /> : <CheckCircle size={16} />}
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
        </>
      )}

      {activeTab === 'staff' && (
        <Card padding={false}>
          {staffLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : staffList.length === 0 ? (
            <EmptyState icon={UserCheck} title="No staff in approved list"
              description="Add staff members who are allowed to register"
              action={<Button onClick={() => setAddStaffOpen(true)}><UserPlus size={14} /> Add Staff</Button>}
            />
          ) : (
            <div className="divide-y divide-gray-50">
              {staffList.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-gray-600 font-bold text-sm">{s.name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.email} · {s.employee_id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={ROLE_COLORS[s.role]}>{s.role.toUpperCase()}</Badge>
                    <span className={clsx('text-xs font-medium', s.account_active !== null ? 'text-green-600' : 'text-gray-400')}>
                      {s.account_active !== null ? '✓ Registered' : '⏳ Not yet registered'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <AddUserModal open={addUserOpen} onClose={() => setAddUserOpen(false)} />
      <AddStaffModal open={addStaffOpen} onClose={() => setAddStaffOpen(false)} />
    </div>
  );
}
