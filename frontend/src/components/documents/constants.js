export const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : `http://${window.location.hostname}:5000`;

export const DOC_TYPE_LABELS = {
  id_proof: 'ID Proof', ayushman_card: 'Ayushman Card',
  admission_photo: 'Admission Photo', prescription: 'Prescription',
  lab_reports: 'Lab Reports', scans: 'Scans / Radiology', discharge_summary: 'Discharge Summary', other: 'Other',
};

export const DOC_TYPE_COLORS = {
  id_proof: 'bg-purple-50 text-purple-700 border-purple-100',
  ayushman_card: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  admission_photo: 'bg-blue-50 text-blue-700 border-blue-100',
  prescription: 'bg-green-50 text-green-700 border-green-100',
  lab_reports: 'bg-red-50 text-red-700 border-red-100',
  scans: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  discharge_summary: 'bg-teal-50 text-teal-700 border-teal-100',
  other: 'bg-gray-50 text-gray-700 border-gray-100',
};
