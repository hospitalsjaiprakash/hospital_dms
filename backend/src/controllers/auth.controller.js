const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken } = require('../middleware/auth.middleware');
const { sendSuccess, sendError } = require('../utils/response');
const { createAuditLog, ACTIONS } = require('../services/audit.service');
const logger = require('../utils/logger');

const signup = async (req, res) => {
  let { password, name, employee_id, role } = req.body;
  if (employee_id) employee_id = employee_id.trim();
  if (name) name = name.trim();

  // Check if already registered
  const existingUser = await db.query('SELECT id FROM users WHERE employee_id = $1', [employee_id]);
  if (existingUser.rows.length) {
    return sendError(res, 'Account already exists for this employee', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await db.query(
    `INSERT INTO users (name, employee_id, password_hash, plain_password, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, role, employee_id`,
    [name, employee_id, passwordHash, password, role, false]
  );

  const user = result.rows[0];

  await createAuditLog({
    userId: user.id,
    userRole: user.role,
    action: ACTIONS.USER_CREATE,
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });

  return sendSuccess(res, { user }, 'Account created successfully. Pending admin approval.', 201);
};

const login = async (req, res) => {
  let { employee_id, password } = req.body;
  if (employee_id) employee_id = employee_id.trim();

  const userRes = await db.query(
    `SELECT id, name, email, role, employee_id, password_hash, is_active, last_login, login_attempts, locked_until
     FROM users WHERE employee_id = $1`,
    [employee_id]
  );

  if (!userRes.rows.length) {
    await createAuditLog({ 
      action: ACTIONS.LOGIN_FAILED, 
      entityType: 'auth', 
      userEmail: employee_id, 
      ipAddress: req.ip,
      newValues: { attempted_id: employee_id }
    });
    return sendError(res, 'Invalid employee ID or password', 401);
  }

  const user = userRes.rows[0];

  if (!user.is_active) {
    if (user.last_login === null) {
      return sendError(res, 'Account has not been approved yet. Contact admin.', 403);
    }
    return sendError(res, 'Account has been deactivated. Contact admin.', 403);
  }

  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    await createAuditLog({ 
      action: ACTIONS.LOGIN_FAILED, 
      entityType: 'auth', 
      userId: user.id, 
      userEmail: user.email, 
      ipAddress: req.ip,
      newValues: { attempted_id: employee_id }
    });
    return sendError(res, 'Invalid employee ID or password', 401);
  }

  // Increment session version on successful login
  const updateRes = await db.query(
    'UPDATE users SET last_login = NOW(), session_version = session_version + 1 WHERE id = $1 RETURNING session_version',
    [user.id]
  );

  const sessionVersion = updateRes.rows[0].session_version;
  const token = generateToken(user.id, user.role, sessionVersion);

  await createAuditLog({
    userId: user.id,
    userEmail: user.email,
    userRole: user.role,
    action: ACTIONS.LOGIN,
    entityType: 'auth',
    entityId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const { password_hash, login_attempts, locked_until, ...safeUser } = user;

  return sendSuccess(res, { user: safeUser, token }, 'Login successful');
};

const getMe = async (req, res) => {
  const userRes = await db.query(
    'SELECT id, name, email, role, employee_id, last_login, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  return sendSuccess(res, userRes.rows[0]);
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!userRes.rows.length) {
    return sendError(res, 'User not found', 404);
  }

  const user = userRes.rows[0];
  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  
  if (!isValid) {
    return sendError(res, 'Incorrect current password', 401);
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 12);

  await db.query(
    'UPDATE users SET password_hash = $1, plain_password = $2, session_version = session_version + 1, updated_at = NOW() WHERE id = $3',
    [newPasswordHash, newPassword, userId]
  );

  await createAuditLog({
    userId,
    userEmail: req.user.email,
    userRole: req.user.role,
    action: ACTIONS.PASSWORD_CHANGE,
    entityType: 'auth',
    entityId: userId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, null, 'Password changed successfully');
};

module.exports = { signup, login, getMe, changePassword };
