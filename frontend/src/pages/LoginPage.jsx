import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from '../components/common';
import { Eye, EyeOff, User, Lock, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import AuthLayout from '../components/layout/AuthLayout';
import JPHBUILD from '../assets/JPHBUILD.jpeg';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async (data) => {
    try {
      await login(data);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    }
  };

  return (
<AuthLayout reverse={false} backgroundImage={JPHBUILD}>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Sign In</h2>
          <p className="text-gray-500 text-sm mt-2 font-medium">Access your medical document portal</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Input
            label="Employee ID"
            type="text"
            placeholder="e.g. 23001"
            icon={User}
            required
            className="!bg-gray-50/50 !border-gray-200 focus:!bg-white focus:!border-blue-500 transition-all !py-3.5"
            error={errors.employee_id?.message}
            {...register('employee_id', {
              required: 'Employee ID is required',
            })}
          />

          <div className="space-y-1">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider ml-1 mb-1.5">
              Password
            </label>
            <div className="relative group/pass">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within/pass:text-blue-500 transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-12 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none hover:border-gray-300 transition-all"
                {...register('password', { required: 'Password is required' })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-600 mt-1 ml-1">{errors.password.message}</p>}
          </div>

          <Button 
            type="submit" 
            loading={isSubmitting} 
            className="w-full !rounded-xl !py-4 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transform active:scale-[0.98] transition-all font-bold text-base"
            size="lg"
          >
            Sign In <ArrowRight size={18} className="ml-1" />
          </Button>
        </form>

        <div className="mt-10 text-center">
          <p className="text-sm text-gray-500 font-medium">
            Don't have an account?{' '}
            <Link to="/signup" className="text-blue-600 font-bold hover:text-blue-700 transition-colors inline-flex items-center gap-1 group">
              Create an account
              <span className="transform group-hover:translate-x-1 transition-transform">→</span>
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
