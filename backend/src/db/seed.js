requ
const bcrypt = require('bcryptjs');
const db = require('./index');
const logger = require('../utils/logger');

async function seed() {
  logger.info('Seeding database...');

  // Seed staff master
  const staffData = [
    { name: 'System Admin', email: 'admin@hospital.com', employee_id: 'EMP001', role: 'admin', department: 'Administration' },
    { name: 'Dr. HOD Singh', email: 'hod@hospital.com', employee_id: 'EMP002', role: 'hod', department: 'General' },
    { name: 'PCC Coordinator 1', email: 'pcc1@hospital.com', employee_id: 'EMP003', role: 'pcc', department: 'Admissions' },
    { name: 'PCC Coordinator 2', email: 'pcc2@hospital.com', employee_id: 'EMP004', role: 'pcc', department: 'Admissions' },
  ];

  for (const staff of staffData) {
    await db.query(
      `INSERT INTO staff_master (name, email, employee_id, role, department)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [staff.name, staff.email, staff.employee_id, staff.role, staff.department]
    );
  }

  // Seed users with hashed passwords
  const password = await bcrypt.hash('Hospital@123', 12);

  for (const staff of staffData) {
    const staffRecord = await db.query('SELECT id FROM staff_master WHERE email = $1', [staff.email]);
    if (staffRecord.rows.length > 0) {
      await db.query(
        `INSERT INTO users (staff_id, name, email, employee_id, password_hash, role, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO NOTHING`,
        [staffRecord.rows[0].id, staff.name, staff.email, staff.employee_id, password, staff.role, staff.department]
      );
    }
  }

  // Seed sample patients
  const adminUser = await db.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
  if (adminUser.rows.length > 0) {
    const adminId = adminUser.rows[0].id;
    const patients = [
      { uhid: 'UHID-2024-001', name: 'Ramesh Kumar', mobile: '9876543210', admission_date: '2024-01-15', hospital_status: 'active', settlement_status: 'pending' },
      { uhid: 'UHID-2024-002', name: 'Priya Sharma', mobile: '9876543211', admission_date: '2024-01-10', hospital_status: 'discharged', settlement_status: 'pending' },
      { uhid: 'UHID-2024-003', name: 'Amit Patel', mobile: '9876543212', admission_date: '2024-01-05', hospital_status: 'discharged', settlement_status: 'completed', discharge_date: '2024-01-20' },
    ];

    for (const p of patients) {
      await db.query(
        `INSERT INTO patients (uhid, name, mobile, admission_date, discharge_date, hospital_status, settlement_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (uhid) DO NOTHING`,
        [p.uhid, p.name, p.mobile, p.admission_date, p.discharge_date || null, p.hospital_status, p.settlement_status, adminId]
      );
    }
  }

  logger.info('Database seeded successfully.');
  logger.info('Default credentials: admin@hospital.com / Hospital@123');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed failed', { error: err.message });
    process.exit(1);
  });
