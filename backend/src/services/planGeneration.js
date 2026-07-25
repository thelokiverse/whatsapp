// Orchestrates exercise plan generation (v2 Phase 7b, revised after real use
// with an actual elderly recipient - see README gotcha on the CDC library
// pivot): Gemini selects and sequences a 28-day rotation from a fixed,
// hand-curated, pre-tagged CDC exercise library (never generates new
// exercises), falling back to a deterministic round-robin if the response is
// malformed. Every unique exercise's media (a real senior-appropriate demo
// GIF, known upfront) is resolved once and cached - subsequent recipients and
// regenerations reuse the same cached media instead of re-uploading. Saved to
// exercise_catalog + plan_rotations as pending_review for the caregiver to
// review and approve.

const { pool } = require('../config/db');
const { selectCdcPlan } = require('../llm/gemini');
const { CDC_EXERCISES } = require('./cdcExerciseLibrary');
const { getOrUploadMediaId } = require('../whatsapp/mediaCache');

const ROTATION_DAYS = 28;
const EXERCISES_PER_DAY = 5; // 2 warmup + 2 main + 1 cooldown, in that fixed order

function filterByContraindications(medicalConditions) {
  const conditions = new Set(medicalConditions || []);
  return CDC_EXERCISES.filter((ex) => !ex.contraindication_tags.some((t) => conditions.has(t)));
}

function compactView(exercises) {
  return exercises.map((e) => ({ id: e.id, name: e.name, target_area: e.target_area }));
}

// Deliberately ignores day.day_offset entirely - Gemini does not reliably
// start numbering at 0 (confirmed by testing: a request for a 3-day plan
// came back offsets 1,2,3 instead of 0,1,2). daily_plans is looked up by
// exact day_offset match (see conversationEngine.exerciseIdsForToday), so an
// off-by-one here doesn't error, it silently falls through to the unrelated
// v1 fallback path instead - which is exactly what happened in production
// (a real recipient got the old hand-typed "Seated Marching" instead of the
// reviewed CDC plan). The caller re-indexes by array position instead.
function isValidDayShape(day, warmupIds, mainIds, cooldownIds) {
  if (!Array.isArray(day.exercise_ids) || day.exercise_ids.length !== EXERCISES_PER_DAY) return false;
  const [w1, w2, m1, m2, c1] = day.exercise_ids;
  if (!warmupIds.has(w1) || !warmupIds.has(w2)) return false;
  if (!mainIds.has(m1) || !mainIds.has(m2) || m1 === m2) return false;
  if (!cooldownIds.has(c1)) return false;
  return true;
}

// Deterministic, no-LLM rotation used when Gemini's selection is missing,
// malformed, or references an invalid ID - cycles through the filtered pools
// so every exercise gets used roughly evenly across the rotation.
function roundRobinFallback(warmups, mains, cooldowns, numDays) {
  const days = [];
  for (let i = 0; i < numDays; i += 1) {
    const w1 = warmups[i % warmups.length].id;
    const w2 = warmups[(i + 1) % warmups.length].id;
    let m1 = mains[(i * 2) % mains.length].id;
    let m2 = mains[(i * 2 + 1) % mains.length].id;
    if (m2 === m1) m2 = mains[(i * 2 + 2) % mains.length].id;
    const c1 = cooldowns[i % cooldowns.length].id;
    days.push({ day_offset: i, exercise_ids: [w1, w2, m1, m2, c1] });
  }
  return days;
}

async function selectDaysWithFallback(profile, warmups, mains, cooldowns, numDays) {
  const warmupIds = new Set(warmups.map((e) => e.id));
  const mainIds = new Set(mains.map((e) => e.id));
  const cooldownIds = new Set(cooldowns.map((e) => e.id));

  try {
    const raw = await selectCdcPlan(profile, compactView(warmups), compactView(mains), compactView(cooldowns), numDays);
    const valid =
      Array.isArray(raw.plan) &&
      raw.plan.length === numDays &&
      raw.plan.every((d) => isValidDayShape(d, warmupIds, mainIds, cooldownIds));
    if (valid) {
      // Re-index by array position (day_offset 0..numDays-1) - never trust
      // Gemini's own day_offset value, only that there are exactly numDays
      // entries in the intended order.
      return raw.plan.map((d, i) => ({ day_offset: i, exercise_ids: d.exercise_ids }));
    }
    console.warn('Gemini plan selection was malformed, using round-robin fallback');
  } catch (err) {
    console.warn(`Gemini plan selection failed, using round-robin fallback: ${err.message}`);
  }
  return roundRobinFallback(warmups, mains, cooldowns, numDays);
}

// Ensures every exercise in the given (filtered) set has a exercise_catalog
// row with resolved media, reusing an existing row/cached media if one
// already exists (checked by name) rather than re-uploading. Because the CDC
// library is small and shared across all recipients, after the very first
// plan generation ever, subsequent generations just hit the cache.
async function ensureCatalogRows(exercises) {
  const idByCdcId = new Map();

  for (const ex of exercises) {
    const { rows } = await pool.query('select id, video_media_id from exercise_catalog where name = $1', [ex.name]);

    let videoMediaId = null;
    try {
      videoMediaId = await getOrUploadMediaId(ex.gif_url);
    } catch (err) {
      console.warn(`Media resolution failed for "${ex.name}": ${err.message}`);
      videoMediaId = rows[0]?.video_media_id || null; // reuse a possibly-stale id over none at all
    }

    if (rows[0]) {
      if (videoMediaId !== rows[0].video_media_id) {
        await pool.query('update exercise_catalog set video_media_id = $1 where id = $2', [videoMediaId, rows[0].id]);
      }
      idByCdcId.set(ex.id, rows[0].id);
      continue;
    }

    const { rows: inserted } = await pool.query(
      `insert into exercise_catalog
         (name, session_role, target_area, simple_instruction, duration_or_reps,
          gif_url, video_media_id, source, contraindication_tags)
       values ($1, $2, $3, $4, $5, $6, $7, 'cdc', $8)
       returning id`,
      [
        ex.name,
        ex.session_role,
        ex.target_area,
        ex.simple_instruction,
        ex.duration_or_reps,
        ex.gif_url,
        videoMediaId,
        JSON.stringify(ex.contraindication_tags),
      ]
    );
    idByCdcId.set(ex.id, inserted[0].id);
  }

  return idByCdcId;
}

async function generateRotationPlan(recipient, numDays = ROTATION_DAYS) {
  const profile = {
    age: recipient.age,
    gender: recipient.gender,
    height_cm: recipient.height_cm,
    weight_kg: recipient.weight_kg,
    activity_level: recipient.activity_level,
    medical_conditions: recipient.medical_conditions || [],
  };

  const filtered = filterByContraindications(profile.medical_conditions);
  const warmups = filtered.filter((e) => e.session_role === 'warmup');
  const mains = filtered.filter((e) => e.session_role === 'main');
  const cooldowns = filtered.filter((e) => e.session_role === 'cooldown');

  if (warmups.length < 2 || mains.length < 2 || cooldowns.length < 1) {
    throw new Error(
      `Not enough safe exercises available for recipient ${recipient.id} given their medical conditions`
    );
  }

  const days = await selectDaysWithFallback(profile, warmups, mains, cooldowns, numDays);
  const idByCdcId = await ensureCatalogRows(filtered);

  const dailySequences = days.map((day) => ({
    day_offset: day.day_offset,
    exercise_ids: day.exercise_ids.map((cdcId) => idByCdcId.get(cdcId)),
  }));

  const { rows } = await pool.query(
    `insert into plan_rotations (care_recipient_id, generated_at, valid_until, daily_sequences, status)
     values ($1, now(), now() + interval '${numDays} days', $2, 'pending_review')
     returning *`,
    [recipient.id, JSON.stringify(dailySequences)]
  );

  return { rotation: rows[0] };
}

async function approveRotation(rotationId) {
  const { rows } = await pool.query(
    `update plan_rotations set status = 'active' where id = $1 returning *`,
    [rotationId]
  );
  return rows[0];
}

// Replaces one exercise in the rotation's daily_sequences with a different
// catalog exercise. Callers should only offer options from the
// contraindication-filtered catalog (see onboardingApi.js's
// /catalog/filtered endpoint) - this does not re-validate on its own.
async function swapExercise(rotationId, dayOffset, exerciseIndex, newExerciseId) {
  const { rows } = await pool.query('select * from plan_rotations where id = $1', [rotationId]);
  const rotation = rows[0];
  if (!rotation) throw new Error('Rotation not found');

  const daily = rotation.daily_sequences.map((day) => {
    if (day.day_offset !== dayOffset) return day;
    const exerciseIds = [...day.exercise_ids];
    exerciseIds[exerciseIndex] = newExerciseId;
    return { ...day, exercise_ids: exerciseIds };
  });

  const { rows: updated } = await pool.query(
    'update plan_rotations set daily_sequences = $1 where id = $2 returning *',
    [JSON.stringify(daily), rotationId]
  );
  return updated[0];
}

module.exports = {
  generateRotationPlan,
  approveRotation,
  swapExercise,
};
