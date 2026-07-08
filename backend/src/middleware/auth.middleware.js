const jwt = require('jsonwebtoken');
const db = require('../db');
const { sendError } = require('../utils/response');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Verify JWT and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(res, 'Authentication required', 401);
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 'Token expired. Please login again.', 401);
      }
      return sendError(res, 'Invalid token', 401);
    }

    const userRes = await db.query(
      'SELECT id, name, email, role, employee_id, is_active, session_version FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!userRes.rows.length || !userRes.rows[0].is_active) {
      return sendError(res, 'Account not found or deactivated', 401);
    }

    const user = userRes.rows[0];

    // Prevent concurrent logins: check if the token's session version matches the current one in the DB
    if (decoded.sessionVersion !== undefined && decoded.sessionVersion !== user.session_version) {
      return sendError(res, 'Session expired due to login from another device. Please login again.', 401);
    }

    req.user = user;
    next();
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    return sendError(res, 'Authentication failed', 500);
  }
};

/**
 * Role-based access control middleware factory
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 'Authentication required', 401);
    if (!allowedRoles.includes(req.user.role)) {
      return sendError(res, 'Insufficient permissions', 403);
    }
    next();
  };
};

/**
 * Generate access token
 */
const generateToken = (userId, role, sessionVersion) => {
  return jwt.sign(
    { userId, role, sessionVersion },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};

/**
 * Document ownership check
 * PCC: own only | HOD: own + PCC | Admin: all
 */
const canModifyDocument = (requestingUser, documentUploadedBy, documentUploaderRole) => {
  if (requestingUser.role === 'admin' || requestingUser.role === 'hod') return true;
  if (requestingUser.id === documentUploadedBy) return true;
  return false;
};

module.exports = { authenticate, authorize, generateToken, canModifyDocument };
