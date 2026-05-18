import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from 'react-query';
import ReactSelect from 'react-select';
import clsx from 'clsx';
import { patientApi, documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, Select } from '../components/common';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { ArrowLeft, User, Hash, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { DOC_TYPE_LABELS } from '../components/documents/constants';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export default function NewPatientPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { register, handleSubmit, control, formState: { errors }, setValue } = useForm();
  const [isDetectedReadmission, setIsDetectedReadmission] = useState(false);
  const [matchedPatient, setMatchedPatient] = useState(null);

  const isRestricted = ['pcc', 'nursing'].includes(user?.role);
  const isReadmission = !!searchParams.get('uhid') || isDetectedReadmission;

  const handleUhidCheck = async (uhidVal) => {
    const val = uhidVal?.trim().toUpperCase();
    if (val && /^[A-Z0-9]{11}$/.test(val)) {
      try {
        const res = await patientApi.getAll({ search: val, limit: 1 });
        if (res.data.items && res.data.items.length > 0) {
          const exactMatch = res.data.items.find(p => p.uhid.toUpperCase() === val);
          if (exactMatch) {
            setMatchedPatient(exactMatch);
            setValue('name', exactMatch.name);
            setIsDetectedReadmission(exactMatch.hospital_status === 'discharged');
            
            if (exactMatch.hospital_status === 'active') {
              toast.error(`Patient is already actively admitted!`, { id: 'active-patient-toast' });
            } else {
              toast.success(`Discharged patient found! Registering re-admission.`, { id: 'discharged-patient-toast' });
            }
            return;
          }
        }
      } catch (err) {
        console.error('Error checking UHID:', err);
      }
    }
    setMatchedPatient(null);
    setIsDetectedReadmission(false);
  };

  useEffect(() => {
    const uhid = searchParams.get('uhid');
    const name = searchParams.get('name');
    if (uhid) {
      setValue('uhid', uhid);
      handleUhidCheck(uhid);
    }
    if (name) setValue('name', name);
  }, [searchParams, setValue]);

  const [docFiles, setDocFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const { mutate: createPatient, isLoading: isCreating } = useMutation(patientApi.create);

  const onSubmit = async (data) => {
    try {
      if (matchedPatient && matchedPatient.hospital_status === 'active') {
        toast.error('Cannot admit a patient who is already actively admitted!');
        return;
      }

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
      queryClient.invalidateQueries('audit-logs');
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
          <h1 className="text-xl font-bold text-gray-900">{isReadmission ? 'Re-admit Patient' : 'New Patient'}</h1>
          <p className="text-gray-400 text-sm">{isReadmission ? 'Registering a new admission cycle' : 'Fill in the patient details below'}</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Full Name" placeholder="Patient full name" required icon={User}
                error={errors.name?.message}
                readOnly={!!matchedPatient}
                className={matchedPatient ? "bg-gray-50 opacity-80 cursor-not-allowed" : ""}
                {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Min 2 characters' } })}
              />
            </div>

            <Input
              label="UHID" placeholder="JPH20261234" required icon={Hash}
              error={errors.uhid?.message}
              readOnly={!!matchedPatient}
              className={matchedPatient ? "bg-gray-50 opacity-80 cursor-not-allowed" : ""}
              {...register('uhid', { 
                required: 'UHID is required', 
                minLength: { value: 11, message: 'UHID must be 11 chars' },
                maxLength: { value: 11, message: 'UHID must be 11 chars' },
                pattern: { value: /^[A-Z0-9]{11}$/, message: 'Invalid UHID' }
              })}
              onChange={(e) => {
                const val = e.target.value;
                register('uhid').onChange(e);
                if (val.length === 11) {
                  handleUhidCheck(val);
                } else {
                  setMatchedPatient(null);
                  setIsDetectedReadmission(false);
                }
              }}
            />

            {/* Matched Patient Information Card */}
            {matchedPatient && (
              <div className="sm:col-span-2 p-4 rounded-2xl border bg-gray-50/50 space-y-3 animate-slide-up">
                <div className="flex items-start justify-between">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                      {matchedPatient.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">{matchedPatient.name}</h4>
                      <p className="text-xs text-gray-500 font-mono">UHID: {matchedPatient.uhid}</p>
                    </div>
                  </div>
                  <span className={clsx(
                    "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shadow-sm",
                    matchedPatient.hospital_status === 'active' 
                      ? "bg-green-50 text-green-700 border-green-200" 
                      : "bg-blue-50 text-blue-700 border-blue-200"
                  )}>
                    {matchedPatient.hospital_status === 'active' ? 'Active / Admitted' : 'Discharged'}
                  </span>
                </div>

                {matchedPatient.hospital_status === 'active' ? (
                  <div className="p-3 bg-amber-50 border border-amber-200/60 rounded-xl space-y-2">
                    <p className="text-xs text-amber-800 font-medium flex items-start gap-1.5">
                      <AlertCircle size={16} className="flex-shrink-0 text-amber-600 mt-0.5" />
                      <span>
                        This patient is currently admitted under IP Number <strong>{matchedPatient.ip_number}</strong>. You cannot create a new admission cycle for a currently active patient.
                      </span>
                    </p>
                    <div className="flex gap-2 pl-5">
                      <Button 
                        size="xs" 
                        onClick={() => navigate(`/patients/${matchedPatient.id}`)}
                      >
                        View Patient Profile
                      </Button>
                      <button 
                        type="button"
                        onClick={() => {
                          setMatchedPatient(null);
                          setIsDetectedReadmission(false);
                          setValue('uhid', '');
                          setValue('name', '');
                        }}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-1 bg-white border border-gray-200 rounded-lg shadow-sm"
                      >
                        Reset Form
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-50 border border-blue-200/60 rounded-xl space-y-2">
                    <p className="text-xs text-blue-800 font-medium flex items-start gap-1.5">
                      <CheckCircle size={16} className="flex-shrink-0 text-blue-600 mt-0.5" />
                      <span>
                        Patient record found! You are registering a new admission cycle (<strong>Re-admission</strong>) for this patient.
                      </span>
                    </p>
                    <div className="flex gap-4 text-xs font-semibold text-blue-700 pl-5">
                      <span>Previous IP: {matchedPatient.ip_number}</span>
                      <span>Last Admitted: {matchedPatient.admission_date ? new Date(matchedPatient.admission_date).toLocaleDateString('en-GB') : '—'}</span>
                    </div>
                    <div className="flex gap-2 pl-5 pt-1">
                      <button 
                        type="button"
                        onClick={() => {
                          setMatchedPatient(null);
                          setIsDetectedReadmission(false);
                          setValue('uhid', '');
                          setValue('name', '');
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white px-3 py-1 rounded-lg border border-blue-200 shadow-sm"
                      >
                        Reset / Enter Different UHID
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Input
              label="IP Number" placeholder="IP2026/001" required icon={Hash}
              error={errors.ip_number?.message}
              {...register('ip_number', { required: 'IP Number is required' })}
            />

            <Input
              label={isReadmission ? "Re-admission Date & Time" : "Admission Date & Time"} 
              type="datetime-local" required icon={Calendar}
              max={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              error={errors.admission_date?.message}
              {...register('admission_date', { required: 'Admission date and time is required' })}
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
              <div className="mt-3 space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Document Type *</label>
                <Controller
                  name="doc_type"
                  control={control}
                  rules={{ required: docFiles.length > 0 ? 'Please select document type' : false }}
                  render={({ field }) => (
                    <ReactSelect
                      {...field}
                      options={DOC_TYPES}
                      value={DOC_TYPES.find(c => c.value === field.value) || null}
                      onChange={val => field.onChange(val.value)}
                      placeholder="Search or select type..."
                      className="text-sm"
                      menuPortalTarget={document.body}
                      styles={{
                        control: (base, state) => ({
                          ...base,
                          borderColor: errors.doc_type ? '#ef4444' : (state.isFocused ? '#3b82f6' : '#e5e7eb'),
                          borderRadius: '0.5rem',
                          minHeight: '42px',
                          boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
                          '&:hover': { borderColor: state.isFocused ? '#3b82f6' : '#d1d5db' }
                        }),
                        menuPortal: (base) => ({ ...base, zIndex: 9999 })
                      }}
                    />
                  )}
                />
                {errors.doc_type && <p className="text-xs text-red-500 mt-1">{errors.doc_type.message}</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => navigate(-1)} disabled={isCreating || isUploading} className="w-full sm:w-auto">Cancel</Button>
            <Button 
              type="submit" 
              loading={isCreating || isUploading} 
              disabled={matchedPatient && matchedPatient.hospital_status === 'active'}
              className="w-full sm:w-auto"
            >
              {isUploading ? `Uploading ${docFiles.length} file(s)...` : (isReadmission ? 'Re-admit Patient' : 'Create Patient')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
