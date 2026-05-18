import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from 'react-query';
import ReactSelect from 'react-select';
import clsx from 'clsx';
import { patientApi, documentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, Badge, Modal } from '../components/common';
import CameraFileUploader from '../components/documents/CameraFileUploader';
import { ArrowLeft, User, Hash, Calendar, AlertCircle, CheckCircle, Clock, File, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { DOC_TYPE_LABELS } from '../components/documents/constants';
import { format } from 'date-fns';

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_COLORS = { active: 'green', discharged: 'blue', pending: 'amber', completed: 'green' };

export default function NewPatientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { register, handleSubmit, control, formState: { errors }, setValue } = useForm();

  // Modal state for initial UHID/Name lookup
  const [showLookupModal, setShowLookupModal] = useState(true);
  const [lookupUhid, setLookupUhid] = useState('');
  const [lookupName, setLookupName] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [lookupResult, setLookupResult] = useState(null);

  // Form state
  const [isReadmission, setIsReadmission] = useState(false);
  const [matchedPatient, setMatchedPatient] = useState(null);
  const [admissionHistory, setAdmissionHistory] = useState([]);
  const [docFiles, setDocFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const isRestricted = ['pcc', 'nursing'].includes(user?.role);

  // Handle UHID lookup in modal - Auto-search when 11 chars entered
  const handleUhidChange = async (value) => {
    const val = value?.trim().toUpperCase();
    setLookupUhid(val);
    
    // Auto-search when UHID is exactly 11 characters
    if (val && val.length === 11 && /^[A-Z0-9]{11}$/.test(val)) {
      setIsChecking(true);
      try {
        const res = await patientApi.getAll({ search: val, limit: 10 });
        const patients = res.data || [];
        
        if (patients.length > 0) {
          const exactMatch = patients.find(p => p.uhid?.toUpperCase() === val);
          if (exactMatch) {
            // Fetch full patient details
            const fullPatient = await patientApi.getOne(exactMatch.id);
            const patientData = fullPatient.data;
            const status = patientData.hospital_status;

            setLookupResult({
              found: true,
              patient: patientData,
              status: status
            });

            // Auto-populate Name field
            setLookupName(patientData.name);

            // Trigger corresponding status popups
            if (status === 'active') {
              toast.error('Patient is already admitted (Active status). Please discharge first before re-admitting.');
            } else if (status === 'discharged') {
              toast.success('Patient is discharged, you can readmit.');
            }

            setIsChecking(false);
            return;
          }
        }

        // Not found - new patient
        setLookupResult({ found: false, patient: null, status: 'new' });
      } catch (err) {
        console.error('Error checking UHID:', err);
        toast.error('Error fetching patient record');
      }
      setIsChecking(false);
    } else {
      // Clear result and matched name if UHID is incomplete or invalid
      if (lookupResult?.found) {
        setLookupName('');
      }
      setLookupResult(null);
    }
  };

  // Handle "Start" button for new patient
  const handleStartNewPatient = () => {
    setValue('uhid', lookupUhid);
    setValue('name', lookupName);
    setMatchedPatient(null);
    setAdmissionHistory([]);
    setIsReadmission(false);
    setShowLookupModal(false);
    setLookupResult(null);
  };

  // Handle "Re-admit" button for discharged patient
  const handleStartReadmission = () => {
    const patient = lookupResult.patient;
    setValue('uhid', patient.uhid);
    setValue('name', patient.name);
    setMatchedPatient(patient);
    setAdmissionHistory(patient.admission_history || []);
    setIsReadmission(true);
    setShowLookupModal(false);
  };

  // Close modal and navigate back
  const handleCloseLookupModal = () => {
    setShowLookupModal(false);
    navigate(-1);
  };

  // Handle back from form to modal
  const handleBackToModal = () => {
    setShowLookupModal(true);
    setMatchedPatient(null);
    setAdmissionHistory([]);
    setIsReadmission(false);
    setDocFiles([]);
    setLookupResult(null);
    setValue('ip_number', '');
    setValue('admission_date', '');
    setValue('doc_type', '');
  };

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
    <>
      {/* ===== LOOKUP MODAL ===== */}
      <Modal open={showLookupModal && !matchedPatient} onClose={handleCloseLookupModal} title="New Patient Registration">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Enter patient UHID to check their registration status in the system.</p>
          
          {/* UHID Field */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">UHID *</label>
            <div className="relative">
              <input
                type="text"
                maxLength={11}
                placeholder="JPH20261234"
                value={lookupUhid}
                onChange={(e) => handleUhidChange(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isChecking && (
                <div className="absolute right-3 top-3">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400">{lookupUhid.length}/11 characters</p>
          </div>

          {/* Name Field */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Full Name</label>
            <input
              type="text"
              placeholder="Patient full name"
              value={lookupName}
              onChange={(e) => setLookupName(e.target.value)}
              readOnly={lookupResult?.found && lookupResult?.status !== 'new'}
              className={clsx(
                "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500",
                (lookupResult?.found && lookupResult?.status !== 'new') && "bg-gray-50 opacity-80 cursor-not-allowed font-semibold text-gray-600"
              )}
            />
          </div>

          {/* Dynamic Status Alert Card */}
          {lookupUhid.length === 11 && lookupResult && !isChecking && (
            <div className="animate-fade-in pt-1">
              {lookupResult.status === 'active' && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                  <span>Patient is already active in the system. Please discharge before admitting.</span>
                </div>
              )}
              {lookupResult.status === 'discharged' && (
                <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-xs text-green-700 flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                  <span>Patient found & discharged. Eligible for re-admission.</span>
                </div>
              )}
              {lookupResult.status === 'new' && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 flex items-center gap-2">
                  <CheckCircle size={16} className="text-blue-500 flex-shrink-0" />
                  <span>New patient. Ready to start registration.</span>
                </div>
              )}
            </div>
          )}

          {/* Dynamic Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={handleCloseLookupModal} className="flex-1">
              Cancel
            </Button>

            {(() => {
              // 1. Incomplete UHID
              if (lookupUhid.length < 11) {
                return (
                  <Button variant="secondary" disabled className="flex-1 cursor-not-allowed opacity-50">
                    Enter 11-Digit UHID
                  </Button>
                );
              }

              // 2. Checking state
              if (isChecking) {
                return (
                  <Button variant="secondary" disabled className="flex-1 cursor-not-allowed">
                    Checking...
                  </Button>
                );
              }

              // 3. Status checks
              if (lookupResult) {
                if (lookupResult.status === 'active') {
                  return (
                    <Button 
                      variant="danger" 
                      disabled
                      className="flex-1 cursor-not-allowed opacity-50 font-bold"
                      onClick={(e) => {
                        e.preventDefault();
                        toast.error('Patient is already admitted (Active status). Please discharge first before re-admitting.');
                      }}
                    >
                      Admit Blocked (Active)
                    </Button>
                  );
                }

                if (lookupResult.status === 'discharged') {
                  return (
                    <Button variant="success" onClick={handleStartReadmission} className="flex-1 font-bold">
                      Re-admit Patient
                    </Button>
                  );
                }

                if (lookupResult.status === 'new' || !lookupResult.found) {
                  return (
                    <Button onClick={handleStartNewPatient} className="flex-1 font-bold">
                      Start
                    </Button>
                  );
                }
              }

              // Fallback
              return (
                <Button variant="secondary" disabled className="flex-1 cursor-not-allowed">
                  Search Patient
                </Button>
              );
            })()}
          </div>
        </div>
      </Modal>

      {/* ===== MAIN FORM ===== */}
      {!showLookupModal && (
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToModal}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{isReadmission ? 'Re-admit Patient' : 'New Patient'}</h1>
              <p className="text-gray-400 text-sm">
                {isReadmission
                  ? `Re-admitting ${matchedPatient?.name}`
                  : 'Fill in the patient admission details'
                }
              </p>
            </div>
          </div>

          <Card>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                <div className="sm:col-span-2 animate-slide-up">
                  <Input
                    label="Full Name"
                    placeholder="Patient full name"
                    required
                    icon={User}
                    error={errors.name?.message}
                    readOnly={isReadmission}
                    className={isReadmission ? "bg-gray-50 opacity-80 cursor-not-allowed font-semibold" : ""}
                    {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Min 2 characters' } })}
                  />
                </div>

                {/* UHID (read-only) */}
                <div className="animate-slide-up">
                  <Input
                    label="UHID"
                    placeholder="JPH20261234"
                    required
                    icon={Hash}
                    readOnly
                    className="bg-gray-50 opacity-80 cursor-not-allowed font-semibold"
                    {...register('uhid', { required: 'UHID is required' })}
                  />
                </div>

                {/* IP Number */}
                <div className="animate-slide-up">
                  <Input
                    label={isReadmission ? "New IP Number" : "IP Number"}
                    placeholder="IP2026/001"
                    required
                    icon={Hash}
                    error={errors.ip_number?.message}
                    {...register('ip_number', { required: 'IP Number is required' })}
                  />
                </div>

                {/* Admission Date & Time */}
                <div className="sm:col-span-2 animate-slide-up">
                  <Input
                    label={isReadmission ? "Re-admission Date & Time" : "Admission Date & Time"}
                    type="datetime-local"
                    required
                    icon={Calendar}
                    max={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    error={errors.admission_date?.message}
                    {...register('admission_date', { required: 'Admission date and time is required' })}
                  />
                </div>
              </div>

              {/* Info box */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm animate-slide-up">
                <p className="font-semibold text-blue-800 mb-1.5">Auto-set on creation:</p>
                <ul className="space-y-1 text-blue-700">
                  <li>• Hospital Status → <strong>Active (Admitted)</strong></li>
                  <li>• Settlement Status → <strong>Pending</strong></li>
                </ul>
              </div>

              {/* Documents Section */}
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

              {/* Form Actions */}
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100 animate-slide-up">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleBackToModal}
                  disabled={isCreating || isUploading}
                  className="w-full sm:w-auto"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  loading={isCreating || isUploading}
                  className="w-full sm:w-auto"
                >
                  {isUploading ? `Uploading ${docFiles.length} file(s)...` : (isReadmission ? 'Re-admit Patient' : 'Create Patient')}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
