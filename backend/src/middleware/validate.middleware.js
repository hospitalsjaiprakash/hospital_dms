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
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).required()
      .messages({ 'string.pattern.base': 'Password must contain uppercase, lowercase, and number' }),
    name: Joi.string().min(2).max(200).required(),
    employee_id: Joi.string().min(3).max(50).required(),
    role: Joi.string().valid('pcc', 'hod').required(),
    department: Joi.string().max(100).optional().allow(''),
  }),

  login: Joi.object({
    employee_id: Joi.string().min(3).max(50).required(),
    password: Joi.string().required(),
  }),

  createPatient: Joi.object({
    uhid: Joi.string().min(3).max(50).required(),
    name: Joi.string().min(2).max(200).required(),
    admission_date: Joi.date().iso().max('now').required(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  updatePatient: Joi.object({
    name: Joi.string().min(2).max(200).optional(),
    hospital_status: Joi.string().valid('active', 'discharged').optional(),
    settlement_status: Joi.string().valid('pending', 'completed').optional(),
    discharge_date: Joi.date().iso().optional().allow(null),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  uploadDocument: Joi.object({
    patient_id: Joi.string().uuid().required(),
    doc_type: Joi.string().valid('id_proof', 'ayushman_card', 'admission_photo', 'prescription', 'lab_reports', 'scans', 'discharge_summary', 'other').required(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  updateDocument: Joi.object({
    doc_type: Joi.string().valid('id_proof', 'ayushman_card', 'admission_photo', 'prescription', 'lab_reports', 'scans', 'discharge_summary', 'other').optional(),
    notes: Joi.string().max(500).optional().allow(''),
  }),

  createUser: Joi.object({
    name: Joi.string().min(2).max(200).required(),
    employee_id: Joi.string().min(3).max(50).required(),
    role: Joi.string().valid('pcc', 'hod', 'admin').required(),
    department: Joi.string().max(100).optional().allow(''),
    password: Joi.string().min(8).required(),
  }),
};

module.exports = { validate, schemas };
