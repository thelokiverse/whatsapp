const { pool } = require('../config/db');
const { selectExercisesWithLLM } = require('../llm/gemini');
const { localDateString } = require('../utils/time');

const MIN_EXERCISES = 3;
const MAX_EXERCISES = 4;

function filterByContraindications(exercises, medicalConditions) {
  const conditions = new Set(medicalConditions || []);
  return exercises.filter((exercise) => {
    const contraindications = exercise.contraindications || [];
    return !contraindications.some((c) => conditions.has(c));
  });
}

function validateSelection(candidateIds, filteredExercises) {
  if (!Array.isArray(candidateIds)) return false;
  if (candidateIds.length < MIN_EXERCISES || candidateIds.length > MAX_EXERCISES) return false;
  if (new Set(candidateIds).size !== candidateIds.length) return false; // no duplicates

  const allowedIds = new Set(filteredExercises.map((e) => e.id));
  return candidateIds.every((id) => allowedIds.has(id));
}

// Deterministic fallback used when the LLM is unavailable or returns an
// invalid selection - no retrying it indefinitely, just pick something safe.
function rotationFallback(filteredExercises, recentHistory) {
  const sorted = [...filteredExercises].sort((a, b) => a.id.localeCompare(b.id));
  const recentSet = new Set(recentHistory || []);
  const unused = sorted.filter((e) => !recentSet.has(e.id));

  const candidates = unused.length >= MIN_EXERCISES ? unused : sorted;
  return candidates.slice(0, MAX_EXERCISES).map((e) => e.id);
}

// Pure selection logic: no DB, no network beyond the LLM call. This is what
// gets unit-tested directly with fake profiles.
async function pickExercisesForProfile(profile, allExercises, recentHistory) {
  const filtered = filterByContraindications(allExercises, profile.medical_conditions);

  if (filtered.length === 0) {
    return []; // nothing safe to offer - caller should handle this edge case
  }

  try {
    const llmProfile = {
      mobility_level: profile.mobility_level,
      medical_conditions: profile.medical_conditions || [],
    };
    const candidateIds = await selectExercisesWithLLM(llmProfile, filtered, recentHistory);
    if (validateSelection(candidateIds, filtered)) {
      return candidateIds;
    }
    console.warn('LLM selection failed validation, falling back to rotation:', candidateIds);
  } catch (err) {
    console.warn('LLM selection call failed, falling back to rotation:', err.message);
  }

  return rotationFallback(filtered, recentHistory);
}

async function getRecentHistory(careRecipientId, todayStr, days = 2) {
  const { rows } = await pool.query(
    `select exercise_ids from daily_plans
     where care_recipient_id = $1 and date < $2
     order by date desc limit $3`,
    [careRecipientId, todayStr, days]
  );
  return rows.flatMap((row) => row.exercise_ids);
}

// DB-touching wrapper used by the live conversation flow.
async function selectExercisesForToday(recipient) {
  const { rows: allExercises } = await pool.query('select data from exercise_library');
  const exercises = allExercises.map((row) => row.data);
  const recentHistory = await getRecentHistory(recipient.id, localDateString(recipient.timezone));

  const selected = await pickExercisesForProfile(recipient, exercises, recentHistory);
  if (selected.length === 0) {
    throw new Error(
      `No safe exercises available for recipient ${recipient.id} given their medical_conditions`
    );
  }
  return selected;
}

module.exports = {
  filterByContraindications,
  validateSelection,
  rotationFallback,
  pickExercisesForProfile,
  selectExercisesForToday,
};
