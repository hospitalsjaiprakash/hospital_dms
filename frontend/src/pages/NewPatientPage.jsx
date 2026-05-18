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

  // Handle UHID lookup in modal
  const handleModalLookup = async () => {
    const val = lookupUhid?.trim().toUpperCase();
    if (!val || !/^[A-Z0-9]{11}$/.test(val)) {
      toast.error('Please enter a valid UHID (11 characters)');
      return;
    }

    setIsChecking(true);
    try {
      const res = await patientApi.getAll({ search: val, limit: 1 });
      if (res.data.items && res.data.items.length > 0) {
        const exactMatch = res.data.items.find(p => p.uhid.toUpperCase() === val);
        if (exactMatch) {
          // Fetch full patient details
          const fullPatient = await patientApi.getOne(exactMatch.id);
          setLookupResult({
            found: true,
            patient: fullPatient.data,
            status: fullPatient.data.hospital_status
          });
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
          {!lookupResult ? (
            <>
              {/* Step 1: Enter UHID & Name */}
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Enter patient UHID and name to check if they already exist in the system.</p>
                
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">UHID *</label>
                  <input
                    type="text"
                    maxLength={11}
                    placeholder="JPH20261234"
                    value={lookupUhid}
                    onChange={(e) => setLookupUhid(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400">Must be exactly 11 characters</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Name (Optional for lookup)</label>
                  <input
                    type="text"
                    placeholder="Patient full name"
                    value={lookupName}
                    onChange={(e) => setLookupName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="secondary" onClick={handleCloseLookupModal} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleModalLookup}
                    loading={isChecking}
                    className="flex-1 gap-2"
                  >
                    <Search size={16} />
                    Check Patient
                  </Button>
                </div>
              </div>
            </>
          ) : !lookupResult.found ? (
            <>
              {/* Step 2a: New Patient - Show "Start" */}
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-center space-y-2">
                  <CheckCircle size={32} className="mx-auto text-blue-600" />
                  <p className="text-sm font-semibold text-blue-900">UHID not found in system</p>
                  <p className="text-xs text-blue-700">This is a new patient. Click "Start" to create a new admission record.</p>
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => { setLookupResult(null); setLookupUhid(''); }} className="flex-1">
                    Back
                  </Button>
                  <Button onClick={handleStartNewPatient} className="flex-1">
                    Start
                  </Button>
                </div>
              </div>
            </>
          ) : lookupResult.status === 'active' ? (
            <>
              {/* Step 2b: Active Patient - Show Warning */}
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                  <div className="flex gap-3">
                    <AlertCircle size={24} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">This is an Active Patient</p>
                      <p className="text-xs text-amber-800 mt-1">
                        {lookupResult.patient.name} is currently admitted with IP Number <strong>{lookupResult.patient.ip_number}</strong>. 
                        You must discharge the patient first before creating a new admission.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1">
                  <p><strong>Patient:</strong> {lookupResult.patient.name}</p>
                  <p><strong>UHID:</strong> {lookupResult.patient.uhid}</p>
                  <p><strong>Current IP:</strong> {lookupResult.patient.ip_number}</p>
                  <p><strong>Admitted:</strong> {format(new Date(lookupResult.patient.admission_date), 'dd MMM yyyy')}</p>
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => { setLookupResult(null); setLookupUhid(''); }} className="flex-1">
                    Try Different UHID
                  </Button>
                  <Button
                    onClick={() => navigate(`/patients/${lookupResult.patient.id}`)}
                    className="flex-1"
                  >
                    View Patient Profile
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Step 2c: Discharged Patient - Show "Re-admit" */}
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
                  <div className="flex gap-3">
                    <CheckCircle size={24} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-green-900">Patient Found - Ready for Re-admission</p>
                      <p className="text-xs text-green-800 mt-1">
                        {lookupResult.patient.name} was previously discharged and is eligible for re-admission. Click "Re-admit" to proceed.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1">
                  <p><strong>Patient:</strong> {lookupResult.patient.name}</p>
                  <p><strong>UHID:</strong> {lookupResult.patient.uhid}</p>
                  <p><strong>Previous IP:</strong> {lookupResult.patient.ip_number}</p>
                  <p><strong>Last Admitted:</strong> {format(new Date(lookupResult.patient.admission_date), 'dd MMM yyyy')}</p>
                  <p><strong>Discharged:</strong> {lookupResult.patient.discharge_date ? format(new Date(lookupResult.patient.discharge_date), 'dd MMM yyyy') : 'N/A'}</p>
                </div>

                {lookupResult.patient.admission_history && lookupResult.patient.admission_history.length > 0 && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2">
                    <p className="text-xs font-semibold text-blue-900">Previous Admissions: {lookupResult.patient.admission_history.length}</p>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {lookupResult.patient.admission_history.map((h) => (
                        <div key={h.id} className="text-xs text-blue-800 flex justify-between">
                          <span>IP {h.ip_number}: {format(new Date(h.admission_date), 'dd MMM yyyy')}</span>
                          <Badge variant={STATUS_COLORS[h.hospital_status]} size="xs">{h.hospital_status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => { setLookupResult(null); setLookupUhid(''); }} className="flex-1">
                    Back
                  </Button>
                  <Button onClick={handleStartReadmission} className="flex-1">
                    Re-admit Patient
                  </Button>
                </div>
              </div>
            </>
          )}
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
