require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');
const logger = require('../utils/logger');

async function seed() {
  logger.info('Seeding database...');

  try {
    // Seed admin user with hashed password
    const password = await bcrypt.hash('Admin13574', 12);

    await db.query(
      `INSERT INTO users (name, employee_id, password_hash, role, department, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (employee_id) DO NOTHING`,
      ['System Admin', '13574', password, 'admin', 'Administration']
    );

    logger.info('Database seeded successfully.');
    logger.info('Default credentials: ID: 13574 / Admin13574');
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
