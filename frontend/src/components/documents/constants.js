export const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : `http://${window.location.hostname}:5000`;

export const DOC_TYPE_LABELS = {
  // Patient Identity
  id_proof: 'ID Proof',
  ayushman_card: 'Ayushman Card',
  admission_photo: 'Admission Photo',

  // Clinical Documents
  prescription: 'Prescription',
  clinical_notes: 'Clinical Notes',
  lab_reports: 'Lab Reports',
  scans: 'Scans / Radiology',
  discharge_summary: 'Discharge Summary',
  justification: 'Justification',

  // Surgical & OT Documents
  surgery_notes: 'Surgery Notes',
  ot_notes: 'OT Notes',
  pre_op: 'PRE OP',
  intra_op: 'INTRA OP',
  post_op: 'POST OP',
  implant_invoice: 'Implant Invoice',

  // ICU & Ward Documents
  icu_master_chart: 'ICU Master Chart',
  bedside: 'Bedside',
  procedure: 'Procedure',
  dressing: 'Dressing',
  specimen: 'Specimen',

  // Other
  other: 'Other',
};

export const DOC_TYPE_COLORS = {
  // Patient Identity
  id_proof: 'bg-purple-50 text-purple-700 border-purple-100',
  ayushman_card: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  admission_photo: 'bg-blue-50 text-blue-700 border-blue-100',

  // Clinical Documents
  prescription: 'bg-green-50 text-green-700 border-green-100',
  clinical_notes: 'bg-sky-50 text-sky-700 border-sky-100',
  lab_reports: 'bg-red-50 text-red-700 border-red-100',
  scans: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  discharge_summary: 'bg-teal-50 text-teal-700 border-teal-100',
  justification: 'bg-rose-50 text-rose-700 border-rose-100',

  // Surgical & OT Documents
  surgery_notes: 'bg-orange-50 text-orange-700 border-orange-100',
  ot_notes: 'bg-violet-50 text-violet-700 border-violet-100',
  pre_op: 'bg-orange-50 text-orange-700 border-orange-100',
  intra_op: 'bg-pink-50 text-pink-700 border-pink-100',
  post_op: 'bg-lime-50 text-lime-700 border-lime-100',
  implant_invoice: 'bg-amber-50 text-amber-700 border-amber-100',

  // ICU & Ward Documents
  icu_master_chart: 'bg-red-50 text-red-800 border-red-200',
  bedside: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  procedure: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
  dressing: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  specimen: 'bg-amber-50 text-amber-700 border-amber-100',

  // Other
  other: 'bg-gray-50 text-gray-700 border-gray-100',
};
