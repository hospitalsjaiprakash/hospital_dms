import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from 'react-query';
import { patientApi, documentApi } from '../services/api';
import { Button, Input, Card, Select } from '../components/common';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { ArrowLeft, User, Hash, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

const DOC_TYPES = [
  { value: 'id_proof', label: 'ID Proof' },
  { value: 'ayushman_card', label: 'Ayushman Card' },
  { value: 'admission_photo', label: 'Admission Photo' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab_reports', label: 'Lab Reports' },
  { value: 'scans', label: 'Scans / Radiology' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'other', label: 'Other' },
];

export default function NewPatientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm();

  const [docFiles, setDocFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const { mutate: createPatient, isLoading: isCreating } = useMutation(patientApi.create);

  const onSubmit = async (data) => {
    try {
      if (docFiles.length > 0 && !data.doc_type) {
        toast.error('Please select a document type for the attached files');
        return;
      }

      // Step 1: Create Patient
      const res = await createPatientAsync(data);
      const patientId = res.data.id;

      // Step 2: Upload all documents
      if (docFiles.length > 0) {
        setIsUploading(true);
        for (let i = 0; i < docFiles.length; i++) {
          const f = docFiles[i];
          const formData = new FormData();
          const fileName = `${data.doc_type}_${i + 1}_${Date.now()}.${f.type === 'pdf' ? 'pdf' : 'jpg'}`;
          formData.append('file', f.file, fileName);
          formData.append('patient_id', patientId);
          formData.append('doc_type', data.doc_type);
          await documentApi.upload(formData);
        }
      }

      queryClient.invalidateQueries('patients');
      queryClient.invalidateQueries('stats');
      toast.success(docFiles.length > 0 ? `Patient and ${docFiles.length} document(s) saved!` : 'Patient created successfully!');
      navigate(`/patients/${patientId}`);
    } catch (err) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setIsUploading(false);
    }
  };

  const createPatientAsync = (data) => new Promise((resolve, reject) => {
    createPatient(data, { onSuccess: resolve, onError: reject });
  });

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">New Patient</h1>
          <p className="text-gray-400 text-sm">Fill in the patient details below</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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

          <div className="pt-4 border-t border-gray-100 space-y-4">
            <div>
              <h3 className="text-base font-bold text-gray-800">Initial Document <span className="text-gray-400 font-normal text-sm">(Optional)</span></h3>
              <p className="text-xs text-gray-500 mb-4">Attach an ID proof or admission photo while creating the patient.</p>
            </div>

            <CameraFileUploader
              files={docFiles}
              onChange={setDocFiles}
              disabled={isCreating || isUploading}
            />

            {docFiles.length > 0 && (
              <div className="mt-3">
                <Select
                  label="Type" required
                  error={errors.doc_type?.message}
                  {...register('doc_type', { required: docFiles.length > 0 ? 'Please select document type' : false })}
                >
                  <option value="">Select type...</option>
                  {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => navigate(-1)} disabled={isCreating || isUploading} className="w-full sm:w-auto">Cancel</Button>
            <Button type="submit" loading={isCreating || isUploading} className="w-full sm:w-auto">
              {isUploading ? `Uploading ${docFiles.length} file(s)...` : 'Create Patient'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
