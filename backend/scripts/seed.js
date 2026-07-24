require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

async function seed() {
  const libraryPath = path.join(__dirname, '../../exercise-library.json');
  const raw = fs.readFileSync(libraryPath, 'utf8');
  const { exercises } = JSON.parse(raw);

  const client = await pool.connect();
  try {
    for (const exercise of exercises) {
      await client.query(
        `insert into exercise_library (id, data)
         values ($1, $2)
         on conflict (id) do update set data = excluded.data`,
        [exercise.id, exercise]
      );
    }
    console.log(`Seeded ${exercises.length} exercises into exercise_library.`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
