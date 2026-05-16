const db = require('../db');
const { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } = require('../services/storage.service');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');
const { canModifyDocument } = require('../middleware/auth.middleware');
const archiver = require('archiver');
const https = require('https');
const sharp = require('sharp');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
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
  if (['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype) && fileBuffer.length > MAX_FILE_SIZE) {
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

  let finalFileName = req.file.originalname;
  if (!finalFileName || finalFileName === 'blob' || finalFileName === 'image') {
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    finalFileName = `${doc_type}_${Date.now()}.${ext}`;
  } else if (!finalFileName.includes('.')) {
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    finalFileName = `${finalFileName}.${ext}`;
  }

  const result = await db.query(
    `INSERT INTO documents (patient_id, file_url, s3_key, file_name, file_size, mime_type, doc_type, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [patient_id, url, s3Key, finalFileName, fileBuffer.length, req.file.mimetype, doc_type, notes || null, req.user.id]
  );

  const document = result.rows[0];
  await auditLog(ACTIONS.DOCUMENT_UPLOAD, 'document')(req, document.id, null, { patient_id, doc_type, file_name: finalFileName });

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
      `SELECT d.*, u.name as uploaded_by_name, u.role as uploader_role,
               up_u.name as updated_by_name, up_u.role as updated_by_role
       FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN users up_u ON up_u.id = d.updated_by
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
 * Get a single document by ID
 */
const getDocument = async (req, res) => {
  const { id } = req.params;

  const docRes = await db.query(
    `SELECT d.*, u.name as uploaded_by_name, u.role as uploader_role,
            up_u.name as updated_by_name, up_u.role as updated_by_role
     FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     LEFT JOIN users up_u ON up_u.id = d.updated_by
     WHERE d.id = $1`,
    [id]
  );

  if (!docRes.rows.length) return sendError(res, 'Document not found', 404);
  const doc = docRes.rows[0];

  if (!doc.is_deleted) {
    doc.presigned_url = await getPresignedUrl(doc.s3_key).catch(() => doc.file_url);
  }

  return sendSuccess(res, doc, 'Document fetched');
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
  let finalDocType = doc_type || doc.doc_type;
  let newUrl = doc.file_url;
  let newS3Key = doc.s3_key;
  let newFileName = doc.file_name;
  let newFileSize = doc.file_size;
  let newMimeType = doc.mime_type;

  if (req.file) {
    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      return sendError(res, 'Only JPG, PNG, and PDF files are allowed', 400);
    }
    
    let fileBuffer = req.file.buffer;
    if (['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype) && fileBuffer.length > MAX_FILE_SIZE) {
      fileBuffer = await sharp(fileBuffer).resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      if (fileBuffer.length > MAX_FILE_SIZE) return sendError(res, 'File too large even after compression. Max 1MB allowed.', 400);
    }
    if (req.file.mimetype === 'application/pdf' && fileBuffer.length > MAX_FILE_SIZE) {
      return sendError(res, 'PDF file size exceeds 1MB limit', 400);
    }

    newS3Key = generateS3Key(doc.patient_id, finalDocType, req.file.originalname);
    const { url } = await uploadToS3(fileBuffer, newS3Key, req.file.mimetype, {
      patientId: doc.patient_id,
      docType: finalDocType,
      uploadedBy: req.user.id,
    });

    newUrl = url;
    newFileName = req.file.originalname;
    if (!newFileName || newFileName === 'blob' || newFileName === 'image') {
      const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
      newFileName = `${finalDocType}_${Date.now()}.${ext}`;
    } else if (!newFileName.includes('.')) {
      const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
      newFileName = `${newFileName}.${ext}`;
    }
    
    newFileSize = fileBuffer.length;
    newMimeType = req.file.mimetype;

    // Delete old file asynchronously
    deleteFromS3(doc.s3_key).catch(err => console.error('Failed to delete old file from S3:', err));
  }

  const result = await db.query(
    `UPDATE documents SET doc_type = $1, notes = COALESCE($2, notes),
     file_url = $3, s3_key = $4, file_name = $5, file_size = $6, mime_type = $7,
     updated_by = $8, updated_at = NOW()
     WHERE id = $9 RETURNING *`,
    [finalDocType, notes, newUrl, newS3Key, newFileName, newFileSize, newMimeType, req.user.id, id]
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
    
    let baseName = doc.file_name || 'document';
    if (baseName === 'blob' || baseName === 'image') {
      baseName = `${doc.doc_type}_${new Date(doc.created_at).getTime()}`;
    }
    
    if (!baseName.includes('.')) {
      if (doc.mime_type === 'application/pdf') baseName += '.pdf';
      else if (doc.mime_type === 'image/jpeg') baseName += '.jpg';
      else if (doc.mime_type === 'image/png') baseName += '.png';
      else baseName += '.jpg';
    }

    const fileName = `${doc.doc_type}_${doc.created_at.toISOString().split('T')[0]}_${baseName}`;

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

/**
 * Get all documents across all patients
 */
const getAllDocuments = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const { today, doc_type, search } = req.query;

  const conditions = [`d.is_deleted = false`];
  const params = [];
  let idx = 1;

  if (today === 'true') {
    conditions.push(`d.created_at >= CURRENT_DATE`);
  }
  
  if (doc_type) {
    conditions.push(`d.doc_type = $${idx++}`);
    params.push(doc_type);
  }

  if (search) {
    conditions.push(`(p.name ILIKE $${idx} OR p.uhid ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, docsRes] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FROM documents d 
       JOIN patients p ON p.id = d.patient_id 
       ${where}`, 
      params
    ),
    db.query(
      `SELECT d.*, p.name as patient_name, p.uhid as patient_uhid, 
               u.name as uploaded_by_name, u.role as uploader_role,
               up_u.name as updated_by_name, up_u.role as updated_by_role
       FROM documents d
       JOIN patients p ON p.id = d.patient_id
       JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN users up_u ON up_u.id = d.updated_by
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  const docs = await Promise.all(
    docsRes.rows.map(async (doc) => ({
      ...doc,
      presigned_url: await getPresignedUrl(doc.s3_key).catch(() => doc.file_url),
    }))
  );

  return sendPaginated(res, docs, parseInt(countRes.rows[0].count), page, limit);
};

/**
 * Bulk delete documents
 */
const bulkDeleteDocuments = async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return sendError(res, 'No document IDs provided', 400);
  }

  const results = await db.query(
    `SELECT d.*, u.role as uploader_role FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = ANY($1) AND d.is_deleted = false`,
    [ids]
  );

  const docs = results.rows;
  if (docs.length === 0) return sendError(res, 'No valid documents found to delete', 404);

  // Filter out documents the user cannot modify
  const deletableDocs = docs.filter(doc => canModifyDocument(req.user, doc.uploaded_by, doc.uploader_role));
  const deletableIds = deletableDocs.map(doc => doc.id);

  if (deletableIds.length === 0) {
    return sendError(res, 'You do not have permission to delete any of the selected documents', 403);
  }

  await db.withTransaction(async (client) => {
    await client.query(
      `UPDATE documents SET is_deleted = true, deleted_by = $1, deleted_at = NOW() WHERE id = ANY($2)`,
      [req.user.id, deletableIds]
    );
    for (const doc of deletableDocs) {
      await deleteFromS3(doc.s3_key).catch(err => console.error(`Failed to delete S3 object ${doc.s3_key}:`, err));
    }
  });

  await auditLog(ACTIONS.DOCUMENT_DELETE, 'document')(req, null, { count: deletableIds.length }, { deleted_ids: deletableIds });

  return sendSuccess(res, { deleted_count: deletableIds.length }, `Successfully deleted ${deletableIds.length} document(s)`);
};

module.exports = { 
  uploadDocument, 
  getPatientDocuments, 
  getDocument, 
  updateDocument, 
  deleteDocument, 
  bulkDeleteDocuments,
  exportPatientDocuments,
  getAllDocuments
};
