require('dotenv').config();
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/services/caregiverAuth');

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/create-caregiver.js <email> <password>');
  process.exit(1);
}

async function run() {
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `insert into caregiver_users (email, password_hash)
     values ($1, $2)
     on conflict (email) do update set password_hash = excluded.password_hash
     returning id, email`,
    [email, passwordHash]
  );
  console.log('Caregiver user ready:', rows[0]);
  await pool.end();
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
