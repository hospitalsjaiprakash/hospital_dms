require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

async function changePassword() {
  const adminId = process.argv[2];
  const newPassword = process.argv[3];

  if (!adminId || !newPassword) {
    console.error('❌ Error: Missing arguments.');
    console.error('Usage: node src/db/change-admin-password.js <admin_employee_id> <new_password>');
    process.exit(1);
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const result = await db.query(
      `UPDATE users 
       SET password_hash = $1, plain_password = $2
       WHERE employee_id = $3 AND role = 'admin'
       RETURNING id, name`,
      [hashedPassword, newPassword, adminId]
    );

    if (result.rowCount === 0) {
      console.error('❌ Admin user not found with that employee ID, or they are not an admin.');
    } else {
      console.log(`✅ Password securely updated in the database for: ${result.rows[0].name}`);
    }
  } catch (err) {
    console.error('❌ Error changing password:', err.message);
  } finally {
    process.exit(0);
  }
}

changePassword();
