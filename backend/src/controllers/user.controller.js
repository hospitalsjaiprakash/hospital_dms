const bcrypt = require('bcryptjs');
const db = require('../db');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');

const getUsers = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const { search, role, is_active } = req.query;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) { conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR employee_id ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
  if (role) { conditions.push(`role = $${idx++}`); params.push(role); }
  if (is_active !== undefined) { conditions.push(`is_active = $${idx++}`); params.push(is_active === 'true'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRes, usersRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM users ${where}`, params),
    db.query(
      `SELECT id, name, email, role, employee_id, department, is_active, last_login, created_at
       FROM users ${where}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return sendPaginated(res, usersRes.rows, parseInt(countRes.rows[0].count), page, limit);
};

const createUser = async (req, res) => {
  const { email, name, employee_id, role, department, password } = req.body;

  // Check staff master approval
  const staffRes = await db.query('SELECT * FROM staff_master WHERE email = $1', [email]);
  if (!staffRes.rows.length) {
    // Auto-add to staff master if admin is creating
    await db.query(
      'INSERT INTO staff_master (name, email, employee_id, role, department) VALUES ($1,$2,$3,$4,$5)',
      [name, email, employee_id, role, department]
    );
  }

  const existing = await db.query('SELECT id FROM users WHERE email = $1 OR employee_id = $2', [email, employee_id]);
  if (existing.rows.length) return sendError(res, 'Email or Employee ID already exists', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const staffRecord = await db.query('SELECT id FROM staff_master WHERE email = $1', [email]);

  const result = await db.query(
    `INSERT INTO users (staff_id, name, email, employee_id, password_hash, role, department)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, role, employee_id, department, is_active, created_at`,
    [staffRecord.rows[0]?.id, name, email, employee_id, passwordHash, role, department]
  );

  await auditLog(ACTIONS.USER_CREATE, 'user')(req, result.rows[0].id, null, { name, email, role });

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

const addToStaffMaster = async (req, res) => {
  const { name, email, employee_id, role, department } = req.body;

  const result = await db.query(
    `INSERT INTO staff_master (name, email, employee_id, role, department)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET name=$1, role=$4, department=$5
     RETURNING *`,
    [name, email, employee_id, role, department]
  );

  return sendSuccess(res, result.rows[0], 'Staff added to approved list', 201);
};

const getStaffMaster = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const result = await db.query(
    `SELECT sm.*, u.id as user_id, u.is_active as account_active
     FROM staff_master sm
     LEFT JOIN users u ON u.email = sm.email
     WHERE sm.is_active = true
     ORDER BY sm.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const count = await db.query('SELECT COUNT(*) FROM staff_master WHERE is_active = true');
  return sendPaginated(res, result.rows, parseInt(count.rows[0].count), page, limit);
};

module.exports = { getUsers, createUser, toggleUserStatus, addToStaffMaster, getStaffMaster };
