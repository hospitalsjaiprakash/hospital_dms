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

const getAuditLogs = async ({ entityType, entityId, userId, action, page, limit }) => {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (entityType) { conditions.push(`entity_type = $${idx++}`); params.push(entityType); }
  if (entityId) { conditions.push(`entity_id = $${idx++}`); params.push(entityId); }
  if (userId) { conditions.push(`user_id = $${idx++}`); params.push(userId); }
  if (action) { conditions.push(`action = $${idx++}`); params.push(action); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [countRes, logsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params),
    db.query(
      `SELECT al.*, u.name as user_name FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return { total: parseInt(countRes.rows[0].count), logs: logsRes.rows };
};

module.exports = { createAuditLog, auditLog, getAuditLogs, ACTIONS };
