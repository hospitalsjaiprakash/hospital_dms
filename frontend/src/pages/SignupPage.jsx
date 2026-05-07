import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from '../components/common';
import { Eye, EyeOff, ArrowRight, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import AuthLayout from '../components/layout/AuthLayout';
import JPHBUILD from '../assets/JPHBUILD.webp';

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async (data) => {
    try {
      await signup(data);
      toast.success('Account created. Pending admin approval.');
      navigate('/login');
    } catch (err) {
      toast.error(err.message || 'Signup failed');
    }
  };

  return (
<AuthLayout reverse={true} backgroundImage={JPHBUILD}>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Create Account</h2>
          <p className="text-gray-500 text-sm mt-2 font-medium">Join the hospital document network</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name" placeholder="Dr. John Doe" required
              className="!bg-gray-50/50 !border-gray-200 focus:!bg-white shadow-sm !py-3"
              error={errors.name?.message}
              {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Min 2 chars' } })}
            />
            <Input
              label="Employee ID" placeholder="EMP001" required
              className="!bg-gray-50/50 !border-gray-200 focus:!bg-white shadow-sm !py-3"
              error={errors.employee_id?.message}
              {...register('employee_id', { required: 'Employee ID is required' })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider ml-1 mb-1.5">Role *</label>
              <div className="relative">
                <select className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-3 text-sm outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white shadow-sm appearance-none transition-all"
                  {...register('role', { required: 'Role required' })}>
                  <option value="">Select...</option>
                  <option value="pcc">PCC</option>
                  <option value="hod">HOD</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <ArrowRight size={14} className="rotate-90" />
                </div>
              </div>
              {errors.role && <p className="text-xs text-red-500 mt-1 ml-1">{errors.role.message}</p>}
            </div>
            <Input
              label="Department" placeholder="e.g. General"
              className="!bg-gray-50/50 !border-gray-200 focus:!bg-white shadow-sm !py-3"
              error={errors.department?.message}
              {...register('department')}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider ml-1 mb-1.5">
              Password *
            </label>
            <div className="relative group/pass">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm placeholder-gray-400 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none hover:border-gray-300 transition-all shadow-sm"
                {...register('password', {
                  required: 'Password is required',
                  minLength: { value: 6, message: 'Min 6 characters' }
                })}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-all">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-600 mt-1 ml-1">{errors.password.message}</p>}
          </div>

          <Button 
            type="submit" 
            loading={isSubmitting} 
            className="w-full !rounded-xl !py-4 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transform active:scale-[0.98] transition-all font-bold text-base mt-2" 
            size="lg"
          >
            Create Account <UserPlus size={18} className="ml-1" />
          </Button>
        </form>

        <div className="mt-10 text-center">
          <p className="text-sm text-gray-500 font-medium">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 font-bold hover:text-blue-700 transition-colors inline-flex items-center gap-1 group">
              <span className="transform group-hover:-translate-x-1 transition-transform">←</span>
              Sign in to portal
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
