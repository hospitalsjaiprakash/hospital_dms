const db = require('../db');
const { sendSuccess, sendError, sendPaginated, getPaginationParams } = require('../utils/response');
const { auditLog, ACTIONS } = require('../services/audit.service');
const { deleteFromS3 } = require('../services/storage.service');
const ExcelJS = require('exceljs');

const createPatient = async (req, res) => {
  const { uhid, name, admission_date, ip_number, notes } = req.body;
  
  if (!ip_number || String(ip_number).trim() === '') {
    return sendError(res, 'IP Number is required. Please check if the field is filled.', 400);
  }

  // Check if patient is already active with this UHID
  const activeAdmission = await db.query(
    "SELECT id FROM patients WHERE uhid = $1 AND hospital_status = 'active'", 
    [uhid]
  );
  if (activeAdmission.rows.length) {
    return sendError(res, 'Patient is already admitted (Active status). Please discharge first before re-admitting.', 409);
  }

  // Check IP Number uniqueness
  const existingIP = await db.query('SELECT id FROM patients WHERE ip_number = $1', [ip_number]);
  if (existingIP.rows.length) {
    return sendError(res, 'IP Number already exists. Every admission must have a unique IP number.', 409);
  }

  const result = await db.query(
    `INSERT INTO patients (uhid, name, admission_date, ip_number, notes, hospital_status, settlement_status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', 'pending', $6)
     RETURNING *`,
    [uhid, name, admission_date, ip_number, notes || null, req.user.id]
  );

  const patient = result.rows[0];

  await auditLog(ACTIONS.PATIENT_CREATE, 'patient')(req, patient.id, null, { uhid, name });

  return sendSuccess(res, patient, 'Patient created successfully', 201);
};

const getPatients = async (req, res) => {
  const { page, limit, offset } = getPaginationParams(req.query);
  const { search, hospital_status, settlement_status, admission_date_from, admission_date_to } = req.query;

  // We only aggregate (showing 1 unique patient row based on latest stay) for "All Patients" and "Active (Admitted)" tabs.
  // For "Discharged" and "PMJAY" tabs, we show all stays so past stays can be separately settled.
  const shouldAggregate = !hospital_status || hospital_status === 'active';

  let countQuery, dataQuery, queryParams, finalIdx;

  if (shouldAggregate) {
    const searchConditions = [];
    const searchParams = [];
    let idx = 1;

    if (search) {
      searchConditions.push(`(p.uhid ILIKE $${idx} OR p.name ILIKE $${idx} OR p.ip_number ILIKE $${idx})`);
      searchParams.push(`%${search}%`);
      idx++;
    }

    const searchWhere = searchConditions.length ? `WHERE ${searchConditions.join(' AND ')}` : '';

    const statusConditions = [];
    const statusParams = [];

    if (hospital_status) {
      statusConditions.push(`sub.hospital_status = $${idx++}`);
      statusParams.push(hospital_status);
    }
    if (settlement_status) {
      statusConditions.push(`sub.settlement_status = $${idx++}`);
      statusParams.push(settlement_status);
    }
    if (admission_date_from) {
      statusConditions.push(`sub.admission_date >= $${idx++}`);
      statusParams.push(admission_date_from);
    }
    if (admission_date_to) {
      statusConditions.push(`sub.admission_date <= $${idx++}`);
      statusParams.push(admission_date_to);
    }

    const statusWhere = statusConditions.length ? `WHERE ${statusConditions.join(' AND ')}` : '';
    queryParams = [...searchParams, ...statusParams];
    finalIdx = idx;

    countQuery = `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (p.uhid) p.uhid, p.hospital_status, p.settlement_status, p.admission_date
        FROM patients p
        ${searchWhere}
        ORDER BY p.uhid, p.admission_date DESC
      ) sub
      ${statusWhere}
    `;

    dataQuery = `
      SELECT * FROM (
        SELECT DISTINCT ON (p.uhid) p.*, 
          u.name as created_by_name,
          (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false) as document_count
        FROM patients p
        LEFT JOIN users u ON u.id = p.created_by
        ${searchWhere}
        ORDER BY p.uhid, p.admission_date DESC
      ) sub
      ${statusWhere}
      ORDER BY sub.admission_date DESC
      LIMIT $${finalIdx} OFFSET $${finalIdx + 1}
    `;
  } else {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.uhid ILIKE $${idx} OR p.name ILIKE $${idx} OR p.ip_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (hospital_status) {
      conditions.push(`p.hospital_status = $${idx++}`);
      params.push(hospital_status);
    }
    if (settlement_status) {
      conditions.push(`p.settlement_status = $${idx++}`);
      params.push(settlement_status);
    }
    if (admission_date_from) {
      conditions.push(`p.admission_date >= $${idx++}`);
      params.push(admission_date_from);
    }
    if (admission_date_to) {
      conditions.push(`p.admission_date <= $${idx++}`);
      params.push(admission_date_to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    queryParams = params;
    finalIdx = idx;

    countQuery = `SELECT COUNT(*) FROM patients p ${where}`;
    dataQuery = `
      SELECT p.*, 
        u.name as created_by_name,
        (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false) as document_count
      FROM patients p
      LEFT JOIN users u ON u.id = p.created_by
      ${where}
      ORDER BY p.admission_date DESC
      LIMIT $${finalIdx} OFFSET $${finalIdx + 1}
    `;
  }

  const [countRes, patientsRes] = await Promise.all([
    db.query(countQuery, queryParams),
    db.query(dataQuery, [...queryParams, limit, offset]),
  ]);

  return sendPaginated(res, patientsRes.rows, parseInt(countRes.rows[0].count), page, limit);
};

const getPatient = async (req, res) => {
  const { id } = req.params;

  const result = await db.query(
    `SELECT p.*,
      cu.name as created_by_name,
      uu.name as updated_by_name,
      (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id)::int AS document_count
     FROM patients p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users uu ON uu.id = p.updated_by
     WHERE p.id = $1`,
    [id]
  );

  if (!result.rows.length) return sendError(res, 'Patient not found', 404);

  const patient = result.rows[0];

  // Fetch admission history (other records with same UHID)
  const history = await db.query(
    `SELECT p.id, p.ip_number, p.admission_date, p.discharge_date, p.hospital_status, p.settlement_status, p.created_at, p.settlement_date,
            (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false)::int as doc_count,
            u.name as staff_name
     FROM patients p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.uhid = $1 AND p.id != $2 
     ORDER BY p.admission_date DESC`,
    [patient.uhid, id]
  );

  patient.admission_history = history.rows;

  return sendSuccess(res, patient);
};

const updatePatient = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // PCC and Nursing have limited update access
  if (['pcc', 'nursing'].includes(req.user.role)) {
    const allowedFields = ['name', 'uhid', 'ip_number', 'admission_date', 'notes'];
    const requestedFields = Object.keys(updates);
    const disallowed = requestedFields.filter(f => !allowedFields.includes(f));
    if (disallowed.length) {
      return sendError(res, `${req.user.role.toUpperCase()} cannot update: ${disallowed.join(', ')}`, 403);
    }
  }

  const existing = await db.query('SELECT * FROM patients WHERE id = $1', [id]);
  if (!existing.rows.length) return sendError(res, 'Patient not found', 404);

  const current = existing.rows[0];

  // Business logic: cannot complete settlement if not discharged
  if (updates.settlement_status === 'completed' && (updates.hospital_status || current.hospital_status) === 'active') {
    return sendError(res, 'Patient must be discharged before settlement can be completed', 422);
  }

  // Set discharge_date if discharging (full ISO timestamp)
  if (updates.hospital_status === 'discharged' && current.hospital_status === 'active') {
    updates.discharge_date = updates.discharge_date || new Date().toISOString();
  }

  // Auto-set settlement_date when marking as completed
  if (updates.settlement_status === 'completed' && current.settlement_status !== 'completed') {
    updates.settlement_date = updates.settlement_date || new Date().toISOString();
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

const bulkUpdatePatients = async (req, res) => {
  const { patientIds, hospital_status, settlement_status, discharge_date, settlement_date } = req.body;
  const now = new Date().toISOString();

  if (req.user.role === 'pcc') {
    return sendError(res, 'PCC cannot perform bulk updates', 403);
  }

  try {
    const updatedPatients = await db.withTransaction(async (client) => {
      const updated = [];
      for (const id of patientIds) {
        const existing = await client.query('SELECT * FROM patients WHERE id = $1 FOR UPDATE', [id]);
        if (!existing.rows.length) continue;

        const current = existing.rows[0];
        const updates = {};

        if (hospital_status) updates.hospital_status = hospital_status;
        if (settlement_status) updates.settlement_status = settlement_status;

        // Skip invalid: cannot settle an active patient
        if (updates.settlement_status === 'completed' && (updates.hospital_status || current.hospital_status) === 'active') {
          continue;
        }

        // Set discharge_date (full timestamp) when bulk-discharging
        if (updates.hospital_status === 'discharged' && current.hospital_status === 'active') {
          updates.discharge_date = discharge_date || now;
        }

        // Set settlement_date when bulk-settling
        if (updates.settlement_status === 'completed' && current.settlement_status !== 'completed') {
          updates.settlement_date = settlement_date || now;
        }

        if (Object.keys(updates).length > 0) {
          const fields = Object.keys(updates);
          const values = Object.values(updates);
          const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

          const result = await client.query(
            `UPDATE patients SET ${setClause}, updated_by = $${fields.length + 1}, updated_at = NOW()
             WHERE id = $${fields.length + 2} RETURNING *`,
            [...values, req.user.id, id]
          );
          updated.push({ id, current, updates: result.rows[0] });
        }
      }
      return updated;
    });

    for (const item of updatedPatients) {
      await auditLog(ACTIONS.PATIENT_UPDATE, 'patient')(req, item.id, item.current, item.updates);
    }

    return sendSuccess(res, { updatedCount: updatedPatients.length }, 'Bulk update successful');
  } catch (err) {
    return sendError(res, 'Bulk update failed', 500);
  }
};

const getPatientStats = async (req, res) => {
  const stats = await db.query(`
    SELECT
      -- total_patients (All Patients tab count) is the count of unique patients
      (SELECT COUNT(*)::int FROM (
        SELECT DISTINCT ON (uhid) id FROM patients ORDER BY uhid, admission_date DESC
      ) t) as total_patients,
      
      -- active_patients (Active tab count) is the count of unique active patients
      (SELECT COUNT(*)::int FROM (
        SELECT DISTINCT ON (uhid) id FROM patients WHERE hospital_status = 'active' ORDER BY uhid, admission_date DESC
      ) a) as active_patients,
      
      -- discharged_patients (Discharged tab count) is the count of all discharged stays (not aggregated)
      COUNT(*) FILTER (WHERE hospital_status = 'discharged') as discharged_patients,
      
      -- pending_settlement (PMJAY Pending tab count) is the count of all pending settlements (not aggregated)
      COUNT(*) FILTER (WHERE hospital_status = 'discharged' AND settlement_status = 'pending') as pending_settlement,
      
      -- completed_settlement (PMJAY Settled tab count) is the count of all completed settlements (not aggregated)
      COUNT(*) FILTER (WHERE settlement_status = 'completed') as completed_settlement,
      
      -- admitted_today is the count of all admissions today (not aggregated)
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

const exportPatientsExcel = async (req, res) => {
  const { search, hospital_status, settlement_status } = req.query;

  // Aggregate for "All Patients" and "Active (Admitted)" tabs.
  // For "Discharged" and "PMJAY" tabs, show all stays so they align with the on-screen table.
  const shouldAggregate = !hospital_status || hospital_status === 'active';

  let query, queryParams;

  if (shouldAggregate) {
    const searchConditions = [];
    const searchParams = [];
    let idx = 1;

    if (search) {
      searchConditions.push(`(p.uhid ILIKE $${idx} OR p.name ILIKE $${idx} OR p.ip_number ILIKE $${idx})`);
      searchParams.push(`%${search}%`);
      idx++;
    }

    const searchWhere = searchConditions.length ? `WHERE ${searchConditions.join(' AND ')}` : '';

    const statusConditions = [];
    const statusParams = [];

    if (hospital_status) {
      statusConditions.push(`sub.hospital_status = $${idx++}`);
      statusParams.push(hospital_status);
    }
    if (settlement_status) {
      statusConditions.push(`sub.settlement_status = $${idx++}`);
      statusParams.push(settlement_status);
    }

    const statusWhere = statusConditions.length ? `WHERE ${statusConditions.join(' AND ')}` : '';
    queryParams = [...searchParams, ...statusParams];

    query = `
      SELECT sub.*,
        (SELECT string_agg(DISTINCT u2.name, ', ') 
         FROM documents d 
         JOIN users u2 ON u2.id = d.uploaded_by 
         WHERE d.patient_id = sub.id AND d.is_deleted = false) as photographers
      FROM (
        SELECT DISTINCT ON (p.uhid) p.*,
          (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false) as document_count
        FROM patients p
        ${searchWhere}
        ORDER BY p.uhid, p.admission_date DESC
      ) sub
      ${statusWhere}
      ORDER BY sub.admission_date DESC
    `;
  } else {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.uhid ILIKE $${idx} OR p.name ILIKE $${idx} OR p.ip_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (hospital_status) {
      conditions.push(`p.hospital_status = $${idx++}`);
      params.push(hospital_status);
    }
    if (settlement_status) {
      conditions.push(`p.settlement_status = $${idx++}`);
      params.push(settlement_status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    queryParams = params;

    query = `
      SELECT p.*,
        (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id AND d.is_deleted = false) as document_count,
        (SELECT string_agg(DISTINCT u2.name, ', ') 
         FROM documents d 
         JOIN users u2 ON u2.id = d.uploaded_by 
         WHERE d.patient_id = p.id AND d.is_deleted = false) as photographers
      FROM patients p
      ${where}
      ORDER BY p.admission_date DESC
    `;
  }

  const patientsRes = await db.query(query, queryParams);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Patients');

  worksheet.columns = [
    { header: 'Patient Name', key: 'name', width: 25 },
    { header: 'UHID Number', key: 'uhid', width: 20 },
    { header: 'IP Number', key: 'ip_number', width: 20 },
    { header: 'Admitted Date', key: 'admitted', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Discharge Date', key: 'discharge', width: 15 },
    { header: 'Documents Count', key: 'docCount', width: 15 },
    { header: 'Uploaded By', key: 'uploadedBy', width: 30 },
    { header: 'PMJAY Status', key: 'pmjay', width: 25 }
  ];

  worksheet.getRow(1).font = { bold: true };

  patientsRes.rows.forEach((p) => {
    let pmjayStatus = p.settlement_status === 'completed' 
      ? `Completed (${new Date(p.updated_at).toISOString().split('T')[0]})` 
      : 'Pending';

    let admittedStr = p.admission_date ? new Date(p.admission_date).toISOString().split('T')[0] : '';
    let dischargeStr = p.discharge_date ? new Date(p.discharge_date).toISOString().split('T')[0] : '';

    worksheet.addRow({
      name: p.name,
      uhid: p.uhid,
      ip_number: p.ip_number || '-',
      admitted: admittedStr,
      status: p.hospital_status === 'active' ? 'Active' : 'Discharged',
      discharge: p.hospital_status === 'discharged' ? dischargeStr : '-',
      docCount: p.document_count || 0,
      uploadedBy: p.photographers || '-',
      pmjay: pmjayStatus
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="patients_export.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
};

const deletePatient = async (req, res) => {
  const { id } = req.params;

  const patientRes = await db.query('SELECT * FROM patients WHERE id = $1', [id]);
  if (!patientRes.rows.length) return sendError(res, 'Patient not found', 404);
  const patient = patientRes.rows[0];

  // Fetch all documents to delete from S3
  const docsRes = await db.query('SELECT s3_key FROM documents WHERE patient_id = $1', [id]);
  const s3Keys = docsRes.rows.map(d => d.s3_key);

  try {
    await db.withTransaction(async (client) => {
      // Delete documents (DB)
      await client.query('DELETE FROM documents WHERE patient_id = $1', [id]);
      // Delete patient (DB)
      await client.query('DELETE FROM patients WHERE id = $1', [id]);
    });

    // Delete files from S3 asynchronously
    if (s3Keys.length > 0) {
      for (const key of s3Keys) {
        deleteFromS3(key).catch(err => console.error('Failed to delete patient file from S3:', { key, error: err.message }));
      }
    }

    await auditLog(ACTIONS.PATIENT_DELETE, 'patient')(req, id, { uhid: patient.uhid, name: patient.name }, null);

    return sendSuccess(res, null, 'Patient and associated documents deleted successfully');
  } catch (err) {
    return sendError(res, 'Failed to delete patient', 500);
  }
};

module.exports = { createPatient, getPatients, getPatient, updatePatient, bulkUpdatePatients, getPatientStats, getUploadHistory, exportPatientsExcel, deletePatient };
