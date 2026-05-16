const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../middleware/validate.middleware');

// Controllers
const authCtrl = require('../controllers/auth.controller');
const patientCtrl = require('../controllers/patient.controller');
const documentCtrl = require('../controllers/document.controller');
const userCtrl = require('../controllers/user.controller');
const auditCtrl = require('../controllers/audit.controller');

const router = express.Router();

/**
 * MULTER CONFIGURATION
 * memoryStorage keeps the file in req.file.buffer so your controller
 * can save it locally via the StorageService.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, PDF allowed.'));
    }
  },
});

// ── Auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/signup', validate(schemas.signup), authCtrl.signup);
router.post('/auth/login', validate(schemas.login), authCtrl.login);
router.get('/auth/me', authenticate, authCtrl.getMe);

// ── Patients ─────────────────────────────────────────────────────────────────
router.get('/patients/stats', authenticate, patientCtrl.getPatientStats);
router.get('/patients/upload-history', authenticate, patientCtrl.getUploadHistory);
router.get('/patients/export', authenticate, patientCtrl.exportPatientsExcel);
router.get('/patients', authenticate, patientCtrl.getPatients);
router.post('/patients', authenticate, validate(schemas.createPatient), patientCtrl.createPatient);
router.post('/patients/bulk', authenticate, validate(schemas.bulkUpdatePatients), patientCtrl.bulkUpdatePatients);
router.get('/patients/:id', authenticate, patientCtrl.getPatient);
router.patch('/patients/:id', authenticate, validate(schemas.updatePatient), patientCtrl.updatePatient);
router.delete('/patients/:id', authenticate, patientCtrl.deletePatient);

// ── Documents ────────────────────────────────────────────────────────────────
router.get('/documents', authenticate, documentCtrl.getAllDocuments);
router.post(
  '/documents',
  authenticate,
  upload.single('file'), 
  validate(schemas.uploadDocument, 'body'),
  documentCtrl.uploadDocument
);

router.get('/patients/:patient_id/documents', authenticate, documentCtrl.getPatientDocuments);
router.get('/documents/:id', authenticate, documentCtrl.getDocument);
router.patch(
  '/documents/:id',
  authenticate,
  upload.single('file'),
  validate(schemas.updateDocument, 'body'),
  documentCtrl.updateDocument
);
router.delete('/documents/:id', authenticate, documentCtrl.deleteDocument);
router.post('/documents/bulk-delete', authenticate, documentCtrl.bulkDeleteDocuments);
router.get('/patients/:patient_id/documents/export', authenticate, documentCtrl.exportPatientDocuments);

// ── Users (Admin & HOD) ──────────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin', 'hod'), userCtrl.getUsers);
router.post('/users', authenticate, authorize('admin', 'hod'), validate(schemas.createUser), userCtrl.createUser);
router.patch('/users/:id/status', authenticate, authorize('admin', 'hod'), userCtrl.toggleUserStatus);

// ── Audit Logs (Admin & HOD) ────────────────────────────────────────────────
router.get('/audit-logs', authenticate, authorize('admin', 'hod', 'pcc', 'nursing'), auditCtrl.getLogs);

// ── Health Check ─────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const { healthCheck } = require('../db');
    const dbHealth = await healthCheck();
    res.json({ 
      status: 'ok', 
      db: dbHealth, 
      uptime: process.uptime(), 
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

module.exports = router;