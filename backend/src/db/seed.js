require('dotenv').config({ override: true });
const bcrypt = require('bcryptjs');
const db = require('./index');
const logger = require('../utils/logger');

async function seed() {
  logger.info('Seeding database...');

  try {
    // Get admin credentials from environment variables
    const adminName = process.env.ADMIN_NAME || 'System Admin';
    const adminId = process.env.ADMIN_EMPLOYEE_ID;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Validate required environment variables
    if (!adminId || !adminPassword) {
      logger.warn('⚠️  Admin credentials not configured in environment variables.');
      logger.warn('Please set ADMIN_EMPLOYEE_ID and ADMIN_PASSWORD in your .env file.');
      logger.warn('Database seeding skipped for security reasons.');
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    await db.query(
      `INSERT INTO users (name, employee_id, password_hash, role, department, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (employee_id) 
       DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
      [adminName, adminId, hashedPassword, 'admin', 'Administration']
    );

    logger.info('✅ Database seeded successfully.');
    logger.info('✅ Admin user created/verified.');
  } catch (err) {
    logger.error('Seed failed', { error: err.message });
    process.exit(1);
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed execution failed', { error: err.message });
    process.exit(1);
  });
