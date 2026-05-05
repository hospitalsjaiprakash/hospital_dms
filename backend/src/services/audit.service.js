const db = require('../db');
const logger = require('../utils/logger');

const ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PATIENT_CREATE: 'patient_create',
  PATIENT_UPDATE: 'patient_update',
  PATIENT_VIEW: 'patient_view',
  DOCUMENT_UPLOAD: 'document_upload',
  DOCUMENT_UPDATE: 'document_update',
  DOCUMENT_DELETE: 'document_delete',
  DOCUMENT_VIEW: 'document_view',
  DOCUMENT_DOWNLOAD: 'document_download',
  EXPORT_ZIP: 'export_zip',
  USER_CREATE: 'user_create',
  USER_UPDATE: 'user_update',
  USER_DEACTIVATE: 'user_deactivate',
};

/**
 * Create an immutable audit log entry
 * Fails silently to not break main operations
 */
const createAuditLog = async ({ userId, userEmail, userRole, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent }) => {
  try {
    await db.query(
      `INSERT INTO audit_logs 
       (user_id, user_email, user_role, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId || null,
        userEmail || null,
        userRole || null,
        action,
        entityType,
        entityId || null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress || null,
        userAgent || null,
      ]
    );
  } catch (err) {
    logger.error('Failed to create audit log', { error: err.message, action, entityType });
  }
};

/**
 * Build audit middleware factory for req context
 */
const auditLog = (action, entityType) => {
  return async (req, entityId, oldValues, newValues) => {
    await createAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      action,
      entityType,
      entityId,
      oldValues,
      newValues,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
  };
};

const getAuditLogs = async ({ entityType, entityId, userId, action, page, limit, requesterRole, requesterId, patientActivityOnly }) => {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (entityType) { conditions.push(`al.entity_type = $${idx++}`); params.push(entityType); }
  if (entityId) { conditions.push(`al.entity_id = $${idx++}`); params.push(entityId); }
  if (userId) { conditions.push(`al.user_id = $${idx++}`); params.push(userId); }
  if (action) { conditions.push(`al.action = $${idx++}`); params.push(action); }

  if (patientActivityOnly && requesterRole !== 'admin') {
    // Legacy: keep for backward compat
    conditions.push(`al.entity_type IN ('patient', 'document')`);
  } else if (requesterRole === 'hod') {
    // HOD sees: only patient & document activity (no user mgmt / auth logs)
    // and only from themselves or PCC users — never admin-only actions
    conditions.push(`al.entity_type IN ('patient', 'document')`);
    conditions.push(`(al.user_id = $${idx++} OR al.user_role = 'pcc')`);
    params.push(requesterId);
  } else if (requesterRole === 'pcc') {
    // PCC sees: their own activity + ALL patient/document operations by anyone (including admin)
    conditions.push(`(al.user_id = $${idx++} OR al.entity_type IN ('patient', 'document'))`);
    params.push(requesterId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [countRes, logsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM audit_logs al ${where}`, params),
    db.query(
      `SELECT al.*, u.name as user_name, 
              d.file_name as document_name, d.doc_type as document_type, 
              p.name as patient_name, p.uhid,
              target_u.name as target_user_name, target_u.employee_id as target_user_emp_id
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN users target_u ON al.entity_type = 'user' AND al.entity_id::text = target_u.id::text
       LEFT JOIN documents d ON al.entity_type = 'document' AND al.entity_id::text = d.id::text
       LEFT JOIN patients p ON d.patient_id = p.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return { total: parseInt(countRes.rows[0].count), logs: logsRes.rows };
};

module.exports = { createAuditLog, auditLog, getAuditLogs, ACTIONS };
