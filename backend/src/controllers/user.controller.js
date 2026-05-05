const bcrypt = require('bcryptjs');
const db = require('../db');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');

const getUsers = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const { search, role, status } = req.query;

  const conditions = ['role != $1'];
  const params = ['admin'];
  let idx = 2;

  if (search) { conditions.push(`(name ILIKE $${idx} OR employee_id ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
  if (role) { conditions.push(`role = $${idx++}`); params.push(role); }
  
  if (status === 'active') {
    conditions.push(`is_active = true`);
  } else if (status === 'pending') {
    // Pending users are accounts that were created but never activated or logged in.
    conditions.push(`is_active = false AND last_login IS NULL AND updated_at = created_at`);
  } else if (status === 'inactive') {
    conditions.push(`is_active = false AND (last_login IS NOT NULL OR updated_at <> created_at)`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRes, usersRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM users ${where}`, params),
    db.query(
      `SELECT id, name, role, employee_id, department, is_active, last_login, created_at, plain_password
       FROM users ${where}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return sendPaginated(res, usersRes.rows, parseInt(countRes.rows[0].count), page, limit);
};

const createUser = async (req, res) => {
  const { name, employee_id, role, department, password } = req.body;

  const existing = await db.query('SELECT id FROM users WHERE employee_id = $1', [employee_id]);
  if (existing.rows.length) return sendError(res, 'Employee ID already exists', 409);

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await db.query(
    `INSERT INTO users (name, employee_id, password_hash, plain_password, role, department, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, name, role, employee_id, department, is_active, created_at, plain_password`,
    [name, employee_id, passwordHash, password, role, department || null]
  );

  await auditLog(ACTIONS.USER_CREATE, 'user')(req, result.rows[0].id, null, { name, role });

  return sendSuccess(res, result.rows[0], 'User created successfully', 201);
};

const toggleUserStatus = async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) return sendError(res, 'Cannot deactivate your own account', 400);

  const userRes = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!userRes.rows.length) return sendError(res, 'User not found', 404);

  const newStatus = !userRes.rows[0].is_active;
  await db.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [newStatus, id]);

  await auditLog(ACTIONS.USER_UPDATE, 'user')(req, id, { is_active: userRes.rows[0].is_active }, { is_active: newStatus });

  return sendSuccess(res, null, `User ${newStatus ? 'activated' : 'deactivated'} successfully`);
};

module.exports = { getUsers, createUser, toggleUserStatus };
