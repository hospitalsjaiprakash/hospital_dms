const db = require('../db');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');

const createPatient = async (req, res) => {
  const { uhid, name, admission_date, notes } = req.body;

  // Check UHID uniqueness
  const existing = await db.query('SELECT id FROM patients WHERE uhid = $1', [uhid]);
  if (existing.rows.length) {
    return sendError(res, 'UHID already exists', 409);
  }

  const result = await db.query(
    `INSERT INTO patients (uhid, name, admission_date, notes, hospital_status, settlement_status, created_by)
     VALUES ($1, $2, $3, $4, 'active', 'pending', $5)
     RETURNING *`,
    [uhid, name, admission_date, notes || null, req.user.id]
  );

  const patient = result.rows[0];

  await auditLog(ACTIONS.PATIENT_CREATE, 'patient')(req, patient.id, null, { uhid, name });

  return sendSuccess(res, patient, 'Patient created successfully', 201);
};

const getPatients = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const { search, hospital_status, settlement_status, admission_date_from, admission_date_to } = req.query;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`(p.uhid ILIKE $${idx} OR p.name ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  if (hospital_status) { conditions.push(`p.hospital_status = $${idx++}`); params.push(hospital_status); }
  if (settlement_status) { conditions.push(`p.settlement_status = $${idx++}`); params.push(settlement_status); }
  if (admission_date_from) { conditions.push(`p.admission_date >= $${idx++}`); params.push(admission_date_from); }
  if (admission_date_to) { conditions.push(`p.admission_date <= $${idx++}`); params.push(admission_date_to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRes, patientsRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM patients p ${where}`, params),
    db.query(
      `SELECT p.*, 
        u.name as created_by_name,
        (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false) as document_count
       FROM patients p
       LEFT JOIN users u ON u.id = p.created_by
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return sendPaginated(res, patientsRes.rows, parseInt(countRes.rows[0].count), page, limit);
};

const getPatient = async (req, res) => {
  const { id } = req.params;

  const result = await db.query(
    `SELECT p.*, 
      cu.name as created_by_name, uu.name as updated_by_name
     FROM patients p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users uu ON uu.id = p.updated_by
     WHERE p.id = $1`,
    [id]
  );

  if (!result.rows.length) return sendError(res, 'Patient not found', 404);

  return sendSuccess(res, result.rows[0]);
};

const updatePatient = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // PCC has limited update access
  if (req.user.role === 'pcc') {
    const allowedFields = ['name', 'notes'];
    const requestedFields = Object.keys(updates);
    const disallowed = requestedFields.filter(f => !allowedFields.includes(f));
    if (disallowed.length) {
      return sendError(res, `PCC cannot update: ${disallowed.join(', ')}`, 403);
    }
  }

  const existing = await db.query('SELECT * FROM patients WHERE id = $1', [id]);
  if (!existing.rows.length) return sendError(res, 'Patient not found', 404);

  const current = existing.rows[0];

  // Business logic: cannot complete settlement if not discharged
  if (updates.settlement_status === 'completed' && (updates.hospital_status || current.hospital_status) === 'active') {
    return sendError(res, 'Patient must be discharged before settlement can be completed', 422);
  }

  // Set discharge_date if discharging
  if (updates.hospital_status === 'discharged' && current.hospital_status === 'active') {
    updates.discharge_date = updates.discharge_date || new Date().toISOString().split('T')[0];
  }

  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  const result = await db.query(
    `UPDATE patients SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = NOW()
     WHERE id = $${fields.length + 2} RETURNING *`,
    [...values, req.user.id, id]
  );

  await auditLog(ACTIONS.PATIENT_UPDATE, 'patient')(req, id, current, updates);

  return sendSuccess(res, result.rows[0], 'Patient updated successfully');
};

const getPatientStats = async (req, res) => {
  const stats = await db.query(`
    SELECT
      COUNT(*) as total_patients,
      COUNT(*) FILTER (WHERE hospital_status = 'active') as active_patients,
      COUNT(*) FILTER (WHERE hospital_status = 'discharged') as discharged_patients,
      COUNT(*) FILTER (WHERE hospital_status = 'discharged' AND settlement_status = 'pending') as pending_settlement,
      COUNT(*) FILTER (WHERE settlement_status = 'completed') as completed_settlement,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as admitted_today
    FROM patients
  `);

  const docStats = await db.query(`
    SELECT COUNT(*) as total_documents,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as uploaded_today
    FROM documents WHERE is_deleted = false
  `);

  return sendSuccess(res, { ...stats.rows[0], ...docStats.rows[0] });
};

const getUploadHistory = async (req, res) => {
  // Hourly uploads for today (hour 0-23)
  const hourlyRes = await db.query(`
    SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
           COUNT(*) AS count
    FROM documents
    WHERE is_deleted = false
      AND created_at >= CURRENT_DATE
      AND created_at < CURRENT_DATE + INTERVAL '1 day'
    GROUP BY hour
    ORDER BY hour
  `);

  // Monthly uploads for the current year
  const monthlyRes = await db.query(`
    SELECT EXTRACT(MONTH FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS month,
           COUNT(*) AS count
    FROM documents
    WHERE is_deleted = false
      AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Kolkata') = EXTRACT(YEAR FROM NOW())
    GROUP BY month
    ORDER BY month
  `);

  // Yearly uploads across all time
  const yearlyRes = await db.query(`
    SELECT EXTRACT(YEAR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS year,
           COUNT(*) AS count
    FROM documents
    WHERE is_deleted = false
    GROUP BY year
    ORDER BY year
  `);

  // Build full 24-hour array
  const hourMap = {};
  hourlyRes.rows.forEach(r => { hourMap[r.hour] = parseInt(r.count); });
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    label: `${String(i).padStart(2,'0')}:00`,
    count: hourMap[i] || 0,
  }));

  // Build full 12-month array
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthMap = {};
  monthlyRes.rows.forEach(r => { monthMap[r.month] = parseInt(r.count); });
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    label: monthNames[i],
    count: monthMap[i + 1] || 0,
  }));

  const yearly = yearlyRes.rows.map(r => ({ label: String(r.year), count: parseInt(r.count) }));

  return sendSuccess(res, { hourly, monthly, yearly });
};

module.exports = { createPatient, getPatients, getPatient, updatePatient, getPatientStats, getUploadHistory };
