const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../middleware/validate.middleware');

// Controllers
const authCtrl = require('../controllers/auth.controller');
const patientCtrl = require('../controllers/patient.controller');
const documentCtrl = require('../controllers/document.controller');
const userCtrl = require('../controllers/user.controller');
const auditCtrl = require('../controllers/audit.controller');

const router = express.Router();

// Multer in-memory storage (max 5MB, then we compress/validate server-side)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPG, PNG, PDF allowed.'));
  },
});

// ── Auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/signup', validate(schemas.signup), authCtrl.signup);
router.post('/auth/login', validate(schemas.login), authCtrl.login);
router.get('/auth/me', authenticate, authCtrl.getMe);

// ── Patients ─────────────────────────────────────────────────────────────────
router.get('/patients/stats', authenticate, patientCtrl.getPatientStats);
router.get('/patients', authenticate, patientCtrl.getPatients);
router.post('/patients', authenticate, validate(schemas.createPatient), patientCtrl.createPatient);
router.get('/patients/:id', authenticate, patientCtrl.getPatient);
router.patch('/patients/:id', authenticate, validate(schemas.updatePatient), patientCtrl.updatePatient);

// ── Documents ─────────────────────────────────────────────────────────────────
router.post(
  '/documents',
  authenticate,
  upload.single('file'),
  validate(schemas.uploadDocument, 'body'),
  documentCtrl.uploadDocument
);
router.get('/patients/:patient_id/documents', authenticate, documentCtrl.getPatientDocuments);
router.patch('/documents/:id', authenticate, validate(schemas.updateDocument), documentCtrl.updateDocument);
router.delete('/documents/:id', authenticate, documentCtrl.deleteDocument);
router.get('/patients/:patient_id/documents/export', authenticate, documentCtrl.exportPatientDocuments);

// ── Users (Admin only) ────────────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin'), userCtrl.getUsers);
router.post('/users', authenticate, authorize('admin'), validate(schemas.createUser), userCtrl.createUser);
router.patch('/users/:id/status', authenticate, authorize('admin'), userCtrl.toggleUserStatus);
router.get('/staff-master', authenticate, authorize('admin'), userCtrl.getStaffMaster);
router.post('/staff-master', authenticate, authorize('admin'), userCtrl.addToStaffMaster);

// ── Audit Logs (Admin & HOD) ──────────────────────────────────────────────────
router.get('/audit-logs', authenticate, authorize('admin', 'hod'), auditCtrl.getLogs);

// ── Health ─────────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const { healthCheck } = require('../db');
  const dbHealth = await healthCheck().catch(() => ({ status: 'unhealthy' }));
  res.json({ status: 'ok', db: dbHealth, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

module.exports = router;
