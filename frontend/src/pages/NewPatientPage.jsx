import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from 'react-query';
import ReactSelect from 'react-select';
import clsx from 'clsx';
import { patientApi, documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, Select, Badge } from '../components/common';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { ArrowLeft, User, Hash, Calendar, AlertCircle, CheckCircle, Clock, File } from 'lucide-react';
import toast from 'react-hot-toast';
import { DOC_TYPE_LABELS } from '../components/documents/constants';
import { format } from 'date-fns';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_COLORS = { active: 'green', discharged: 'blue', pending: 'amber', completed: 'green' };

export default function NewPatientPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { register, handleSubmit, control, formState: { errors }, setValue } = useForm();
  const [isDetectedReadmission, setIsDetectedReadmission] = useState(false);
  const [matchedPatient, setMatchedPatient] = useState(null);
  const [admissionHistory, setAdmissionHistory] = useState([]);
  const [isReAdmissionFormVisible, setIsReAdmissionFormVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const isRestricted = ['pcc', 'nursing'].includes(user?.role);
  const isReadmission = !!searchParams.get('uhid') || isDetectedReadmission;

  const handleUhidCheck = async (uhidVal) => {
    const val = uhidVal?.trim().toUpperCase();
    if (val && /^[A-Z0-9]{11}$/.test(val)) {
      setIsChecking(true);
      try {
        const res = await patientApi.getAll({ search: val, limit: 1 });
        if (res.data.items && res.data.items.length > 0) {
          const exactMatch = res.data.items.find(p => p.uhid.toUpperCase() === val);
          if (exactMatch) {
            // Fetch full patient details with admission history
            const fullPatient = await patientApi.getOne(exactMatch.id);
            setMatchedPatient(fullPatient.data);
            setAdmissionHistory(fullPatient.data.admission_history || []);
            setValue('name', fullPatient.data.name);
            
            if (fullPatient.data.hospital_status === 'active') {
              toast.error(`Patient is already actively admitted!`, { id: 'active-patient-toast' });
            } else {
              toast.success(`Patient record found! Eligible for re-admission.`, { id: 'discharged-patient-toast' });
            }
            setIsChecking(false);
            return;
          }
        }
      } catch (err) {
        console.error('Error checking UHID:', err);
        toast.error('Error fetching patient record');
      }
      setIsChecking(false);
    }
    setMatchedPatient(null);
    setAdmissionHistory([]);
    setIsDetectedReadmission(false);
    setIsReAdmissionFormVisible(false);
  };

  useEffect(() => {
    const uhid = searchParams.get('uhid');
    const name = searchParams.get('name');
    if (uhid) {
      setValue('uhid', uhid);
      handleUhidCheck(uhid);
      setIsReAdmissionFormVisible(true);
      setIsDetectedReadmission(true);
    }
    if (name) setValue('name', name);
  }, [searchParams, setValue]);

  const handleReset = () => {
    setMatchedPatient(null);
    setAdmissionHistory([]);
    setIsDetectedReadmission(false);
    setIsReAdmissionFormVisible(false);
    setValue('uhid', '');
    setValue('name', '');
    setValue('ip_number', '');
    setValue('admission_date', '');
  };

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
            
            {/* Show Full Name field only if NO match is found, or if we are actively filling out the Re-admission Form */}
            {(!matchedPatient || isReAdmissionFormVisible) && (
              <div className="sm:col-span-2 animate-slide-up">
                <Input
                  label="Full Name" placeholder="Patient full name" required icon={User}
                  error={errors.name?.message}
                  readOnly={!!matchedPatient}
                  className={matchedPatient ? "bg-gray-50 opacity-80 cursor-not-allowed font-semibold" : ""}
                  {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Min 2 characters' } })}
                />
              </div>
            )}

            {/* UHID input is ALWAYS shown */}
            <div className="sm:col-span-1">
              <Input
                label="UHID" placeholder="JPH20261234" required icon={Hash}
                error={errors.uhid?.message}
                readOnly={isReAdmissionFormVisible || isChecking}
                className={isReAdmissionFormVisible || isChecking ? "bg-gray-50 opacity-80 cursor-not-allowed font-semibold" : ""}
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
                    setAdmissionHistory([]);
                    setIsDetectedReadmission(false);
                    setIsReAdmissionFormVisible(false);
                  }
                }}
              />
              {isChecking && <p className="text-xs text-blue-600 mt-1">Checking UHID...</p>}
            </div>

            {/* Matched Patient Information Card is shown ONLY when a patient matches */}
            {matchedPatient && (
              <div className="sm:col-span-2 space-y-4 animate-slide-up">
                {/* Patient Info Card */}
                <div className="p-4 rounded-2xl border bg-gray-50/50 space-y-3">
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
                          onClick={handleReset}
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
                          {isReAdmissionFormVisible 
                            ? "Registering a new admission cycle (Re-admission) for this patient. Please fill in the details below."
                            : "Patient record found! This patient was previously discharged and is eligible for re-admission."
                          }
                        </span>
                      </p>
                      <div className="flex gap-4 text-xs font-semibold text-blue-700 pl-5">
                        <span>Previous IP: {matchedPatient.ip_number}</span>
                        <span>Last Admitted: {matchedPatient.admission_date ? new Date(matchedPatient.admission_date).toLocaleDateString('en-GB') : '—'}</span>
                      </div>
                      <div className="flex gap-2 pl-5 pt-1">
                        {!isReAdmissionFormVisible ? (
                          <>
                            <Button 
                              size="sm" 
                              type="button"
                              onClick={() => {
                                setIsReAdmissionFormVisible(true);
                                setIsDetectedReadmission(true);
                              }}
                            >
                              Re-admit Patient
                            </Button>
                            <button 
                              type="button"
                              onClick={handleReset}
                              className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-1 bg-white border border-gray-200 rounded-lg shadow-sm"
                            >
                              Reset Form
                            </button>
                          </>
                        ) : (
                          <button 
                            type="button"
                            onClick={handleReset}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white px-3 py-1 rounded-lg border border-blue-200 shadow-sm"
                          >
                            Reset / Enter Different UHID
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Admission History Section */}
                {admissionHistory.length > 0 && (
                  <div className="p-4 rounded-xl border bg-blue-50/30 border-blue-100/50 space-y-3">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-blue-600" />
                      <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Admission History</h3>
                      <span className="text-xs text-blue-400 font-medium">({admissionHistory.length} record{admissionHistory.length > 1 ? 's' : ''})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                      {admissionHistory.map((h) => (
                        <div 
                          key={h.id}
                          className="bg-white border border-blue-100 rounded-lg p-2.5 text-xs hover:shadow-sm transition-all"
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">IP: {h.ip_number}</span>
                            <div className="flex gap-1">
                              <Badge variant={STATUS_COLORS[h.hospital_status]} size="xs">{h.hospital_status}</Badge>
                              {h.hospital_status === 'discharged' && (
                                <Badge variant={STATUS_COLORS[h.settlement_status]} size="xs">{h.settlement_status}</Badge>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-gray-600">
                              <Calendar size={10} className="text-gray-400" />
                              <span className="font-medium">Admitted: {format(new Date(h.admission_date), 'dd MMM yyyy')}</span>
                            </div>
                            {h.discharge_date && (
                              <div className="flex items-center gap-1 text-purple-700">
                                <CheckCircle size={10} className="text-purple-400" />
                                <span className="font-medium">Discharged: {format(new Date(h.discharge_date), 'dd MMM yyyy')}</span>
                              </div>
                            )}
                            {h.settlement_date && (
                              <div className="flex items-center gap-1 text-green-700">
                                <CheckCircle size={10} className="text-green-500" />
                                <span className="font-medium">PMJAY: {format(new Date(h.settlement_date), 'dd MMM yyyy')}</span>
                              </div>
                            )}
                            <div className="pt-1 mt-1 border-t border-gray-100 flex items-center justify-between text-gray-400">
                              <div className="flex items-center gap-1">
                                <File size={9} /> {h.doc_count || 0} docs
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Show IP Number, Admission Date & Time, and Document Upload ONLY if we are in active creation mode (no match) or once they have explicitly clicked "Re-admit Patient" */}
            {(!matchedPatient || isReAdmissionFormVisible) && (
              <>
                <div className="animate-slide-up">
                  <Input
                    label={isReadmission ? "New IP Number" : "IP Number"} placeholder="IP2026/001" required icon={Hash}
                    error={errors.ip_number?.message}
                    {...register('ip_number', { required: 'IP Number is required' })}
                  />
                </div>

                <div className="animate-slide-up">
                  <Input
                    label={isReadmission ? "Re-admission Date & Time" : "Admission Date & Time"} 
                    type="datetime-local" required icon={Calendar}
                    max={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    error={errors.admission_date?.message}
                    {...register('admission_date', { required: 'Admission date and time is required' })}
                  />
                </div>
              </>
            )}
          </div>

          {(!matchedPatient || isReAdmissionFormVisible) && (
            <>
              {/* Info box */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm animate-slide-up">
                <p className="font-semibold text-blue-800 mb-1.5">Auto-set on creation:</p>
                <ul className="space-y-1 text-blue-700">
                  <li>• Hospital Status → <strong>Active (Admitted)</strong></li>
                  <li>• Settlement Status → <strong>Pending</strong></li>
                </ul>
              </div>

              <div className="pt-4 border-t border-gray-100 space-y-4 animate-slide-up">
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

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100 animate-slide-up">
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
            </>
          )}
        </form>
      </Card>
    </div>
  );
}
