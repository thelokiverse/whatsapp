const { pool } = require('../config/db');

// Phase 3 placeholder: deterministic rotation so the conversation state
// machine has something real to drive through. Phase 4 replaces this with
// LLM-based contraindication-aware selection (same function signature).
async function selectExercisesForToday(recipient) {
  const { rows } = await pool.query('select id from exercise_library order by id limit 4');
  return rows.map((row) => row.id);
}

module.exports = { selectExercisesForToday };
