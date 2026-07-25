const { Pool, types } = require('pg');

// pg's default DATE parser converts to a JS Date using the Node process's
// local timezone, which can shift the calendar day depending on server TZ
// (e.g. local dev vs. Render). We only ever want the plain "YYYY-MM-DD" as
// stored - keep it a string and let the app's own timezone-aware helpers
// (utils/time.js) decide what "today" means for a given recipient.
types.setTypeParser(1082, (val) => val); // 1082 = date

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = { pool };
