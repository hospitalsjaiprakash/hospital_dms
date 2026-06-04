require('dotenv').config({ override: true });
const db = require('./index');
const logger = require('../utils/logger');

async function cleanup() {
  logger.info('🧹 Starting database cleanup...');

  try {
    // Step 1: Delete all documents
    logger.info('Deleting all documents...');
    await db.query('DELETE FROM documents;');
    logger.info('✅ Documents cleared');

    // Step 2: Delete all audit logs
    logger.info('Deleting all audit logs...');
    await db.query('DELETE FROM audit_logs;');
    logger.info('✅ Audit logs cleared');

    // Step 3: Delete all patients
    logger.info('Deleting all patients...');
    await db.query('DELETE FROM patients;');
    logger.info('✅ Patients cleared');

    // Step 4: Delete all non-admin users
    logger.info('Deleting all non-admin users...');
    await db.query("DELETE FROM users WHERE role != 'admin';");
    logger.info('✅ Non-admin users deleted');

    logger.info('');
    logger.info('════════════════════════════════════════');
    logger.info('✅ Database cleanup completed successfully!');
    logger.info('════════════════════════════════════════');
    logger.info('Cleared:');
    logger.info('  • All patient records');
    logger.info('  • All documents');
    logger.info('  • All audit logs');
    logger.info('  • All non-admin users');
    logger.info('Preserved:');
    logger.info('  • System Admin user credentials');
    logger.info('════════════════════════════════════════');
  } catch (err) {
    logger.error('❌ Cleanup failed', { error: err.message });
    process.exit(1);
  }
}

cleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('❌ Cleanup execution failed', { error: err.message });
    process.exit(1);
  });
