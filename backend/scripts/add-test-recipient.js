require('dotenv').config();
const { pool } = require('../src/config/db');

const [, , name, phone, mobilityLevel] = process.argv;

if (!name || !phone || !mobilityLevel) {
  console.error('Usage: node scripts/add-test-recipient.js "<name>" <phone_e164> <low|medium|high>');
  process.exit(1);
}

async function run() {
  const { rows } = await pool.query(
    `insert into care_recipients (name, phone_number, mobility_level)
     values ($1, $2, $3)
     on conflict (phone_number) do update set name = excluded.name, mobility_level = excluded.mobility_level
     returning id, name, phone_number`,
    [name, phone, mobilityLevel]
  );
  console.log('Recipient ready:', rows[0]);
  await pool.end();
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
