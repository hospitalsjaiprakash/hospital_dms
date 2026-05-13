const db = require('./backend/src/db');

async function check() {
  try {
    const res = await db.query("SELECT id, name, role, is_active, last_login, updated_at, created_at FROM users WHERE name ILIKE '%Ambit%';");
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
