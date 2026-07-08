const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken } = require('../middleware/auth.middleware');
const { sendSuccess, sendError } = require('../utils/response');
const { createAuditLog, ACTIONS } = require('../services/audit.service');
const logger = require('../utils/logger');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MIN = 5;

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
    await createAuditLog({ action: ACTIONS.LOGIN_FAILED, entityType: 'auth', userEmail: employee_id, ipAddress: req.ip });
    return sendError(res, 'Invalid employee ID or password', 401);
  }

  const user = userRes.rows[0];

  if (!user.is_active) {
    if (user.last_login === null) {
      return sendError(res, 'Account has not been approved yet. Contact admin.', 403);
    }
    return sendError(res, 'Account has been deactivated. Contact admin.', 403);
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return sendError(res, `Account locked. Try again in ${minutes} minute(s).`, 429);
  }

  let currentAttempts = user.login_attempts;
  
  // If a previous lockout has expired, reset the attempt counter
  if (user.locked_until && new Date(user.locked_until) <= new Date()) {
    currentAttempts = 0;
  }

  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    const attempts = currentAttempts + 1;
    const lockUpdate = attempts >= MAX_LOGIN_ATTEMPTS
      ? `locked_until = NOW() + INTERVAL '${LOCKOUT_DURATION_MIN} minutes',`
      : 'locked_until = NULL,';
    await db.query(
      `UPDATE users SET login_attempts = $1, ${lockUpdate} updated_at = NOW() WHERE id = $2`,
      [attempts, user.id]
    );
    await createAuditLog({ action: ACTIONS.LOGIN_FAILED, entityType: 'auth', userId: user.id, userEmail: user.email, ipAddress: req.ip });
    return sendError(res, 'Invalid employee ID or password', 401);
  }

  // Reset attempts on successful login and increment session version
  const updateRes = await db.query(
    'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = NOW(), session_version = session_version + 1 WHERE id = $1 RETURNING session_version',
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

module.exports = { signup, login, getMe };
