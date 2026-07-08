const db = require('../db');
const { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } = require('../services/storage.service');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');
const { canModifyDocument } = require('../middleware/auth.middleware');
const archiver = require('archiver');
const https = require('https');
const sharp = require('sharp');
const { compressPDFToTarget } = require('../services/pdf.service');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB for images
const MAX_PDF_SIZE_BEFORE_COMPRESSION = 50 * 1024 * 1024; // 50MB limit
const COMPRESSION_TIMEOUT = 300 * 1000; // 5 minutes max for PDF compression

// Background compression queue
const compressionQueue = new Set();

/**
 * Asynchronously compress and re-upload a document
 */
const compressDocumentAsync = async (documentId, originalBuffer, mimeType, s3Key, patient, docType) => {
  if (compressionQueue.has(documentId)) {
    console.log(`Document ${documentId} already in compression queue`);
    return;
  }

  compressionQueue.add(documentId);
  const originalSize = originalBuffer.length;
  console.log(`[ASYNC COMPRESS START] Document ${documentId}: ${(originalSize / 1024 / 1024).toFixed(2)}MB`);

  try {
    let compressedBuffer = originalBuffer;
    let compressed = false;

    // Compress PDF in background
    if (mimeType === 'application/pdf' && originalBuffer.length > 1 * 1024 * 1024) {
      try {
        const startTime = Date.now();
        console.log(`[ASYNC COMPRESS] Starting PDF compression for ${documentId}...`);
        
        const compressedPDF = await Promise.race([
          compressPDFToTarget(originalBuffer),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Compression timeout after ${COMPRESSION_TIMEOUT / 1000}s`)), COMPRESSION_TIMEOUT)
          )
        ]);

        if (compressedPDF && compressedPDF.length < originalBuffer.length) {
          compressedBuffer = compressedPDF;
          compressed = true;
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[ASYNC COMPRESS SUCCESS] Document ${documentId}: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB in ${timeTaken}s`);
        } else {
          console.log(`[ASYNC COMPRESS] No compression benefit for document ${documentId}`);
        }
      } catch (err) {
        console.error(`[ASYNC COMPRESS ERROR] Document ${documentId}: ${err.message}`);
      }
    }

    // If compression happened, upload the compressed version
    if (compressed && compressedBuffer.length < originalBuffer.length) {
      try {
        const compressedS3Key = s3Key.replace(/\.pdf$/, '_compressed.pdf');
        console.log(`[ASYNC COMPRESS] Uploading compressed version to S3: ${compressedS3Key}`);
        
        const { url: compressedUrl } = await uploadToS3(compressedBuffer, compressedS3Key, mimeType, {
          patientId: patient.id,
          docType: docType,
          uploadedBy: 'system',
          isCompressed: 'true',
        });

        // Delete the original uncompressed file from S3
        try {
          console.log(`[ASYNC COMPRESS] Deleting original file from S3: ${s3Key}`);
          await deleteFromS3(s3Key);
          console.log(`[ASYNC COMPRESS] Original file deleted: ${s3Key}`);
        } catch (delErr) {
          console.warn(`[ASYNC COMPRESS] Failed to delete original file ${s3Key}:`, delErr.message);
        }

        // Update document record with compressed version
        const updateResult = await db.query(
          `UPDATE documents SET file_url = $1, s3_key = $2, file_size = $3, is_compressed = true, updated_at = NOW()
           WHERE id = $4 RETURNING *`,
          [compressedUrl, compressedS3Key, compressedBuffer.length, documentId]
        );

        console.log(`[ASYNC COMPRESS COMPLETE] Document ${documentId} updated: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (original file deleted)`);
      } catch (err) {
        console.error(`[ASYNC COMPRESS] Failed to update document ${documentId}:`, err.message);
      }
    } else {
      console.log(`[ASYNC COMPRESS SKIPPED] Document ${documentId}: no compression needed or compression failed`);
    }
  } catch (err) {
    console.error(`[ASYNC COMPRESS ERROR] Document ${documentId}:`, err.message);
  } finally {
    compressionQueue.delete(documentId);
    console.log(`[ASYNC COMPRESS END] Document ${documentId} removed from queue`);
  }
};

const getDownloadNameForDoc = (doc) => {
  let baseName = '';
  
  // We need DOC_TYPE_LABELS but backend doesn't import them, we can just format the doc_type nicely.
  // Replace underscores with spaces and capitalize words
  const formatDocType = (type) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  if (doc.doc_type === 'other' && doc.file_name && !doc.file_name.startsWith('blob') && !doc.file_name.startsWith('image') && !doc.file_name.startsWith('photo_')) {
    baseName = doc.file_name.replace(/\.[^/.]+$/, "");
  } else {
    baseName = formatDocType(doc.doc_type);
  }

  // Handle uhid fallback
  const uhid = doc.patient_uhid || '';
  
  let downloadName = `${baseName} ${uhid}`.trim().replace(/[!@#$%^&*()_+.\/,><?";:]/g, '');

  if (doc.mime_type === 'application/pdf') downloadName += '.pdf';
  else if (doc.mime_type === 'image/jpeg') downloadName += '.jpg';
  else if (doc.mime_type === 'image/png') downloadName += '.png';
  else downloadName += '.jpg';

  return downloadName;
};

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
  const originalSize = fileBuffer.length;

  // QUICK: Only compress images synchronously (Sharp is fast)
  if (['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype) && fileBuffer.length > MAX_FILE_SIZE) {
    try {
      let quality = 85;
      let width = 1920;
      const targetSize = MAX_FILE_SIZE;
      
      fileBuffer = await sharp(req.file.buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, progressive: true })
        .toBuffer();

      while (fileBuffer.length > targetSize && quality >= 10) {
        quality = Math.max(10, quality - 8);
        width = Math.round(width * 0.75);
        fileBuffer = await sharp(req.file.buffer)
          .resize({ width, withoutEnlargement: true })
          .jpeg({ quality, progressive: true })
          .toBuffer();
      }

      if (fileBuffer.length > targetSize) {
        fileBuffer = await sharp(req.file.buffer)
          .resize({ width: 800, withoutEnlargement: true })
          .jpeg({ quality: 5, progressive: true })
          .toBuffer();
      }

      console.log(`Image compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    } catch (err) {
      console.error('Image compression failed:', err.message);
      // Use original if compression fails
    }
  }

  // For PDFs: Upload original immediately, compress async in background
  const patientIdentifier = `${patient.uhid}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const s3Key = generateS3Key(patientIdentifier, doc_type, req.file.originalname);
  const { url } = await uploadToS3(fileBuffer, s3Key, req.file.mimetype, {
    patientId: patient_id,
    docType: doc_type,
    uploadedBy: req.user.id,
  });

  let finalFileName = req.file.originalname;
  if (!finalFileName || finalFileName === 'blob' || finalFileName === 'image' || finalFileName.startsWith('photo_')) {
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    finalFileName = `${doc_type}.${ext}`;
  } else if (!finalFileName.includes('.')) {
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
    finalFileName = `${finalFileName}.${ext}`;
  }

  const result = await db.query(
    `INSERT INTO documents (patient_id, file_url, s3_key, file_name, file_size, mime_type, doc_type, notes, uploaded_by, is_compressed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [patient_id, url, s3Key, finalFileName, fileBuffer.length, req.file.mimetype, doc_type, notes || null, req.user.id, false]
  );

  const document = result.rows[0];
  await auditLog(ACTIONS.DOCUMENT_UPLOAD, 'document')(req, document.id, null, { patient_id, doc_type, file_name: finalFileName });

  // ASYNC: Trigger compression in background for PDFs >= 1MB (don't wait for it)
  if (req.file.mimetype === 'application/pdf' && originalSize >= 1 * 1024 * 1024) {
    console.log(`[UPLOAD] Queuing async compression for document ${document.id} (${(originalSize / 1024 / 1024).toFixed(1)}MB, stored as ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
    setImmediate(() => {
      compressDocumentAsync(document.id, req.file.buffer, req.file.mimetype, s3Key, patient, doc_type)
        .catch(err => console.error('[UPLOAD] Background compression error:', err));
    });
  }

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
               up_u.name as updated_by_name, up_u.role as updated_by_role,
               p.uhid as patient_uhid
       FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN users up_u ON up_u.id = d.updated_by
       LEFT JOIN patients p ON p.id = d.patient_id
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
      download_url: await getPresignedUrl(doc.s3_key, 3600, getDownloadNameForDoc(doc)).catch(() => doc.file_url),
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
            up_u.name as updated_by_name, up_u.role as updated_by_role,
            p.uhid as patient_uhid
     FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     LEFT JOIN users up_u ON up_u.id = d.updated_by
     LEFT JOIN patients p ON p.id = d.patient_id
     WHERE d.id = $1`,
    [id]
  );

  if (!docRes.rows.length) return sendError(res, 'Document not found', 404);
  const doc = docRes.rows[0];

  if (!doc.is_deleted) {
    doc.presigned_url = await getPresignedUrl(doc.s3_key).catch(() => doc.file_url);
    doc.download_url = await getPresignedUrl(doc.s3_key, 3600, getDownloadNameForDoc(doc)).catch(() => doc.file_url);
  }

  return sendSuccess(res, doc, 'Document fetched');
};

/**
 * Update document metadata
 */
const updateDocument = async (req, res) => {
  const { id } = req.params;

  const docRes = await db.query(
    `SELECT d.*, u.role as uploader_role, p.uhid as patient_uhid, p.name as patient_name FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     JOIN patients p ON p.id = d.patient_id
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
    const originalSize = fileBuffer.length;
    
    if (['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype) && fileBuffer.length > MAX_FILE_SIZE) {
      try {
        let quality = 85;
        let width = 1920;
        const targetSize = MAX_FILE_SIZE;
        
        fileBuffer = await sharp(req.file.buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality, progressive: true }).toBuffer();
        while (fileBuffer.length > targetSize && quality >= 10) {
          quality = Math.max(10, quality - 8);
          width = Math.round(width * 0.75);
          fileBuffer = await sharp(req.file.buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality, progressive: true }).toBuffer();
        }
        if (fileBuffer.length > targetSize) {
          fileBuffer = await sharp(req.file.buffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 5, progressive: true }).toBuffer();
        }
        console.log(`Image compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      } catch (err) {
        console.error('Image compression failed:', err.message);
      }
    }

    const patientIdentifier = `${doc.patient_uhid}_${doc.patient_name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    newS3Key = generateS3Key(patientIdentifier, finalDocType, req.file.originalname);
    const { url } = await uploadToS3(fileBuffer, newS3Key, req.file.mimetype, {
      patientId: doc.patient_id,
      docType: finalDocType,
      uploadedBy: req.user.id,
    });

    newUrl = url;
    newFileName = req.file.originalname;
    if (!newFileName || newFileName === 'blob' || newFileName === 'image' || newFileName.startsWith('photo_')) {
      const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
      newFileName = `${finalDocType}.${ext}`;
    } else if (!newFileName.includes('.')) {
      const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
      newFileName = `${newFileName}.${ext}`;
    }
    
    newFileSize = fileBuffer.length;
    newMimeType = req.file.mimetype;

    // Delete old file asynchronously
    deleteFromS3(doc.s3_key).catch(err => console.error('Failed to delete old file from S3:', err));

    // Trigger async compression for PDFs >= 1MB
    if (req.file.mimetype === 'application/pdf' && originalSize >= 1 * 1024 * 1024) {
      console.log(`Queuing async compression for document ${id} (${(originalSize / 1024 / 1024).toFixed(1)}MB)`);
      const patientRes = await db.query('SELECT id, uhid, name FROM patients WHERE id = $1', [doc.patient_id]);
      const patient = patientRes.rows[0];
      if (patient) {
        setImmediate(() => {
          compressDocumentAsync(id, req.file.buffer, req.file.mimetype, newS3Key, patient, finalDocType)
            .catch(err => console.error('Background compression error:', err));
        });
      }
    }
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
    baseName = baseName.replace(/_\d{13}/g, '');
    if (baseName === 'blob' || baseName === 'image' || baseName.startsWith('photo_')) {
      baseName = doc.doc_type;
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
      download_url: await getPresignedUrl(doc.s3_key, 3600, getDownloadNameForDoc(doc)).catch(() => doc.file_url),
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

/**
 * Stream raw document file from S3 to bypass CORS issues on the frontend
 */
const downloadDocumentRaw = async (req, res) => {
  const { id } = req.params;

  try {
    const docRes = await db.query(
      'SELECT s3_key, mime_type, file_name FROM documents WHERE id = $1 AND is_deleted = false',
      [id]
    );

    if (!docRes.rows.length) {
      return sendError(res, 'Document not found', 404);
    }

    const doc = docRes.rows[0];
    const presignedUrl = await getPresignedUrl(doc.s3_key);
    if (!presignedUrl) {
      return sendError(res, 'Download URL could not be generated', 404);
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);

    const httpModule = presignedUrl.startsWith('https') ? require('https') : require('http');
    
    httpModule.get(presignedUrl, (fileStream) => {
      if (fileStream.statusCode !== 200) {
        console.error(`S3 download returned status code ${fileStream.statusCode}`);
        return sendError(res, 'Failed to fetch file from storage', 500);
      }
      fileStream.pipe(res);
    }).on('error', (err) => {
      console.error('Error streaming file from S3:', err);
      if (!res.headersSent) {
        sendError(res, 'Error downloading file', 500);
      }
    });
  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) {
      sendError(res, 'Download failed', 500);
    }
  }
};

module.exports = { 
  uploadDocument, 
  getPatientDocuments, 
  getDocument, 
  updateDocument, 
  deleteDocument, 
  bulkDeleteDocuments,
  exportPatientDocuments,
  getAllDocuments,
  downloadDocumentRaw
};
