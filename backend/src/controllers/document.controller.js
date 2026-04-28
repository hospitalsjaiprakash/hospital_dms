const db = require('../db');
const { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } = require('../services/storage.service');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');
const { canModifyDocument } = require('../middleware/auth.middleware');
const archiver = require('archiver');
const https = require('https');
const sharp = require('sharp');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * Upload a document for a patient
 */
const uploadDocument = async (req, res) => {
  const { patient_id, doc_type, notes } = req.body;

  if (!req.file) return sendError(res, 'No file uploaded', 400);

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    return sendError(res, 'Only JPG, PNG, and PDF files are allowed', 400);
  }

  // Check patient exists and is not settlement-completed
  const patientRes = await db.query('SELECT * FROM patients WHERE id = $1', [patient_id]);
  if (!patientRes.rows.length) return sendError(res, 'Patient not found', 404);

  const patient = patientRes.rows[0];
  if (patient.settlement_status === 'completed') {
    return sendError(res, 'Cannot upload documents for a patient with completed settlement', 422);
  }

  let fileBuffer = req.file.buffer;

  // Compress images if over 1MB
  if (['image/jpeg', 'image/png'].includes(req.file.mimetype) && fileBuffer.length > MAX_FILE_SIZE) {
    fileBuffer = await sharp(fileBuffer)
      .resize({ width: 1920, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    if (fileBuffer.length > MAX_FILE_SIZE) {
      return sendError(res, 'File too large even after compression. Max 1MB allowed.', 400);
    }
  }

  if (req.file.mimetype === 'application/pdf' && fileBuffer.length > MAX_FILE_SIZE) {
    return sendError(res, 'PDF file size exceeds 1MB limit', 400);
  }

  const s3Key = generateS3Key(patient_id, doc_type, req.file.originalname);
  const { url } = await uploadToS3(fileBuffer, s3Key, req.file.mimetype, {
    patientId: patient_id,
    docType: doc_type,
    uploadedBy: req.user.id,
  });

  const result = await db.query(
    `INSERT INTO documents (patient_id, file_url, s3_key, file_name, file_size, mime_type, doc_type, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [patient_id, url, s3Key, req.file.originalname, fileBuffer.length, req.file.mimetype, doc_type, notes || null, req.user.id]
  );

  const document = result.rows[0];
  await auditLog(ACTIONS.DOCUMENT_UPLOAD, 'document')(req, document.id, null, { patient_id, doc_type, file_name: req.file.originalname });

  return sendSuccess(res, document, 'Document uploaded successfully', 201);
};

/**
 * Get documents for a patient
 */
const getPatientDocuments = async (req, res) => {
  const { patient_id } = req.params;
  const { page, limit, offset } = getPaginationParams(req.query);
  const { doc_type } = req.query;

  const conditions = [`d.patient_id = $1`, `d.is_deleted = false`];
  const params = [patient_id];
  let idx = 2;

  if (doc_type) { conditions.push(`d.doc_type = $${idx++}`); params.push(doc_type); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, docsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM documents d ${where}`, params),
    db.query(
      `SELECT d.*, u.name as uploaded_by_name, u.role as uploader_role
       FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  // Generate presigned URLs for secure access
  const docs = await Promise.all(
    docsRes.rows.map(async (doc) => ({
      ...doc,
      presigned_url: await getPresignedUrl(doc.s3_key).catch(() => doc.file_url),
    }))
  );

  return sendPaginated(res, docs, parseInt(countRes.rows[0].count), page, limit);
};

/**
 * Update document metadata
 */
const updateDocument = async (req, res) => {
  const { id } = req.params;

  const docRes = await db.query(
    `SELECT d.*, u.role as uploader_role FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1 AND d.is_deleted = false`,
    [id]
  );

  if (!docRes.rows.length) return sendError(res, 'Document not found', 404);
  const doc = docRes.rows[0];

  if (!canModifyDocument(req.user, doc.uploaded_by, doc.uploader_role)) {
    return sendError(res, 'You do not have permission to modify this document', 403);
  }

  const { doc_type, notes } = req.body;
  const result = await db.query(
    `UPDATE documents SET doc_type = COALESCE($1, doc_type), notes = COALESCE($2, notes),
     updated_by = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [doc_type, notes, req.user.id, id]
  );

  await auditLog(ACTIONS.DOCUMENT_UPDATE, 'document')(req, id, { doc_type: doc.doc_type, notes: doc.notes }, req.body);

  return sendSuccess(res, result.rows[0], 'Document updated');
};

/**
 * Soft delete document
 */
const deleteDocument = async (req, res) => {
  const { id } = req.params;

  const docRes = await db.query(
    `SELECT d.*, u.role as uploader_role FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1 AND d.is_deleted = false`,
    [id]
  );

  if (!docRes.rows.length) return sendError(res, 'Document not found', 404);
  const doc = docRes.rows[0];

  if (!canModifyDocument(req.user, doc.uploaded_by, doc.uploader_role)) {
    return sendError(res, 'You do not have permission to delete this document', 403);
  }

  await db.withTransaction(async (client) => {
    await client.query(
      `UPDATE documents SET is_deleted = true, deleted_by = $1, deleted_at = NOW() WHERE id = $2`,
      [req.user.id, id]
    );
    await deleteFromS3(doc.s3_key);
  });

  await auditLog(ACTIONS.DOCUMENT_DELETE, 'document')(req, id, { doc_type: doc.doc_type }, null);

  return sendSuccess(res, null, 'Document deleted successfully');
};

/**
 * Bulk ZIP export for a patient's documents
 */
const exportPatientDocuments = async (req, res) => {
  const { patient_id } = req.params;

  const patientRes = await db.query('SELECT name, uhid FROM patients WHERE id = $1', [patient_id]);
  if (!patientRes.rows.length) return sendError(res, 'Patient not found', 404);

  const patient = patientRes.rows[0];

  const docsRes = await db.query(
    `SELECT d.*, u.name as uploaded_by_name FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     WHERE d.patient_id = $1 AND d.is_deleted = false
     ORDER BY d.doc_type, d.created_at`,
    [patient_id]
  );

  if (!docsRes.rows.length) return sendError(res, 'No documents found for this patient', 404);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${patient.uhid}_${patient.name.replace(/\s+/g, '_')}_documents.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const doc of docsRes.rows) {
    const presignedUrl = await getPresignedUrl(doc.s3_key);
    const ext = doc.file_name.split('.').pop();
    const fileName = `${doc.doc_type}/${doc.created_at.toISOString().split('T')[0]}_${doc.file_name}`;

    await new Promise((resolve, reject) => {
      https.get(presignedUrl, (fileStream) => {
        archive.append(fileStream, { name: fileName });
        fileStream.on('end', resolve);
        fileStream.on('error', reject);
      }).on('error', reject);
    });
  }

  archive.finalize();
  await auditLog(ACTIONS.EXPORT_ZIP, 'patient')(req, patient_id, null, { document_count: docsRes.rows.length });
};

module.exports = { uploadDocument, getPatientDocuments, updateDocument, deleteDocument, exportPatientDocuments };
