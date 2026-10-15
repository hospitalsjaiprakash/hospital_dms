import React from 'react';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '../../services/api';
import { Button } from './index'; // assuming Button is exported from common/index.js

export default function ChangePasswordModal({ isOpen, onClose }) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, watch, reset } = useForm();

  const newPassword = watch('newPassword');

  if (!isOpen) return null;

  const onSubmit = async (data) => {
    try {
      await authApi.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      toast.success('Password changed successfully');
      reset();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-800">Change Password</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              {...register('currentPassword', { required: 'Current password is required' })}
              className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${
                errors.currentPassword ? 'border-red-300 bg-red-50/30' : 'border-gray-200 bg-gray-50/50'
              }`}
              placeholder="Enter current password"
            />
            {errors.currentPassword && <p className="mt-1 text-xs text-red-500 font-medium">{errors.currentPassword.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              {...register('newPassword', { 
                required: 'New password is required',
                minLength: { value: 6, message: 'Password must be at least 6 characters' }
              })}
              className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${
                errors.newPassword ? 'border-red-300 bg-red-50/30' : 'border-gray-200 bg-gray-50/50'
              }`}
              placeholder="Enter new password"
            />
            {errors.newPassword && <p className="mt-1 text-xs text-red-500 font-medium">{errors.newPassword.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              {...register('confirmPassword', { 
                required: 'Please confirm your new password',
                validate: value => value === newPassword || 'Passwords do not match'
              })}
              className={`w-full px-4 py-2 rounded-xl border focus:ring-2 focus:ring-blue-500 outline-none transition-all ${
                errors.confirmPassword ? 'border-red-300 bg-red-50/30' : 'border-gray-200 bg-gray-50/50'
              }`}
              placeholder="Confirm new password"
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-500 font-medium">{errors.confirmPassword.message}</p>}
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl shadow-md"
            >
              {isSubmitting ? 'Changing...' : 'Change Password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
