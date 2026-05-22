const Joi = require('joi');
const { sendError } = require('../utils/response');

const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      const errors = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
      return sendError(res, 'Validation failed', 400, errors);
    }
    req[source] = value;
    next();
  };
};

// Schemas
const schemas = {
  signup: Joi.object({
    password: Joi.string().min(6).required(),
    name: Joi.string().min(2).max(200).required(),
    employee_id: Joi.string().min(3).max(50).required(),
    role: Joi.string().valid('pcc', 'hod', 'nursing').required(),
  }),

  login: Joi.object({
    employee_id: Joi.string().min(3).max(50).required(),
    password: Joi.string().required(),
  }),

  createPatient: Joi.object({
    uhid: Joi.string().length(11).pattern(/^[A-Z0-9]{11}$/).uppercase().required().messages({
      'string.length': 'UHID must be exactly 11 characters',
      'string.pattern.base': 'UHID must contain only letters and numbers',
      'any.required': 'UHID is required'
    }),
    name: Joi.string().min(2).max(200).required(),
    ip_number: Joi.string().min(1).max(100).required().messages({
      'any.required': 'IP Number is required'
    }),
    admission_date: Joi.date().required(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  updatePatient: Joi.object({
    name: Joi.string().min(2).max(200).optional(),
    uhid: Joi.string().length(11).uppercase().optional().messages({
      'string.length': 'UHID must be exactly 11 characters',
      'string.pattern.base': 'UHID must contain only letters and numbers'
    }),
    admission_date: Joi.date().optional(),
    hospital_status: Joi.string().valid('active', 'discharged').optional(),
    settlement_status: Joi.string().valid('none', 'pending', 'completed').optional(),
    discharge_date: Joi.date().optional().allow(null),
    settlement_date: Joi.date().optional().allow(null),
    pending_date: Joi.date().optional().allow(null),
    ip_number: Joi.string().min(1).max(100).optional(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  bulkUpdatePatients: Joi.object({
    patientIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
    hospital_status: Joi.string().valid('discharged').optional(),
    settlement_status: Joi.string().valid('none', 'completed', 'pending').optional(),
    discharge_date: Joi.date().optional(),
    settlement_date: Joi.date().optional(),
    pending_date: Joi.date().optional(),
  }),

  uploadDocument: Joi.object({
    patient_id: Joi.string().uuid().required(),
    doc_type: Joi.string().valid('id_proof', 'ayushman_card', 'admission_photo', 'prescription', 'lab_reports', 'scans', 'discharge_summary', 'pre_op', 'post_op', 'intra_op', 'bedside', 'procedure', 'specimen', 'dressing', 'other').required(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  updateDocument: Joi.object({
    doc_type: Joi.string().valid('id_proof', 'ayushman_card', 'admission_photo', 'prescription', 'lab_reports', 'scans', 'discharge_summary', 'pre_op', 'post_op', 'intra_op', 'bedside', 'procedure', 'specimen', 'dressing', 'other').optional(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  createUser: Joi.object({
    name: Joi.string().min(2).max(200).required(),
    employee_id: Joi.string().min(3).max(50).required(),
    role: Joi.string().valid('pcc', 'hod', 'admin', 'nursing').required(),
    password: Joi.string().min(6).required(),
  }),
};

module.exports = { validate, schemas };
