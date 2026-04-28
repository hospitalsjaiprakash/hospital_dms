import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from 'react-query';
import { patientApi } from '../services/api';
import { Button, Input, Card } from '../components/common';
import { ArrowLeft, User, Phone, Hash, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NewPatientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm();

  const { mutate, isLoading } = useMutation(patientApi.create, {
    onSuccess: (res) => {
      queryClient.invalidateQueries('patients');
      queryClient.invalidateQueries('stats');
      toast.success('Patient created successfully!');
      navigate(`/patients/${res.data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">New Patient</h1>
          <p className="text-gray-400 text-sm">Fill in the patient details below</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit(mutate)} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Full Name" placeholder="Patient full name" required icon={User}
                error={errors.name?.message}
                {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Min 2 characters' } })}
              />
            </div>

            <Input
              label="UHID" placeholder="UHID-2024-001" required icon={Hash}
              error={errors.uhid?.message}
              {...register('uhid', { required: 'UHID is required', minLength: { value: 3, message: 'Min 3 characters' } })}
            />

            <Input
              label="Mobile Number" placeholder="9876543210" required icon={Phone} type="tel" maxLength={10}
              error={errors.mobile?.message}
              {...register('mobile', {
                required: 'Mobile is required',
                pattern: { value: /^[6-9]\d{9}$/, message: 'Enter valid 10-digit mobile' }
              })}
            />

            <Input
              label="Admission Date" type="date" required icon={Calendar}
              max={new Date().toISOString().split('T')[0]}
              error={errors.admission_date?.message}
              {...register('admission_date', { required: 'Admission date is required' })}
            />
          </div>

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm">
            <p className="font-semibold text-blue-800 mb-1.5">Auto-set on creation:</p>
            <ul className="space-y-1 text-blue-700">
              <li>• Hospital Status → <strong>Active (Admitted)</strong></li>
              <li>• Settlement Status → <strong>Pending</strong></li>
            </ul>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" loading={isLoading}>Create Patient</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
