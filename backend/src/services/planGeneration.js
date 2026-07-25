// Orchestrates AI-generated exercise plan creation (v2 Phase 7b): Gemini
// proposes a 28-day rotation -> the deterministic safety blocklist and
// contraindication check validate every exercise (1 regeneration retry per
// rejected slot, then a hardcoded safe default) -> each unique exercise is
// resolved to real media via WorkoutX + WhatsApp media cache -> the result
// is saved to exercise_catalog + plan_rotations as pending_review, for the
// caregiver to review and approve.

const { pool } = require('../config/db');
const { generateMultiWeekPlan, regenerateSingleExercise } = require('../llm/gemini');
const { isExerciseSafe } = require('./safetyBlocklist');
const { searchExercise } = require('./workoutxClient');
const { getOrUploadMediaId } = require('../whatsapp/mediaCache');
const { AREA_KEYWORDS_BY_TAG } = require('./contraindicationTags');

const ROTATION_DAYS = 28;
const WORKOUTX_THROTTLE_MS = 300; // stay well under WorkoutX's 30/min free-tier limit

const SAFE_DEFAULTS = {
  warmup: {
    name: 'Seated Shoulder Rolls',
    target_area: 'shoulders',
    simple_instruction: 'Sit tall. Roll your shoulders up, back, and down in a smooth circle. Then reverse direction.',
    duration_or_reps: '10 rolls each direction',
  },
  main: {
    name: 'Seated Marching',
    target_area: 'legs',
    simple_instruction: "Sit tall in a chair. Lift one knee up like you're marching, then the other. Keep going slowly.",
    duration_or_reps: '10 lifts each leg',
  },
  cooldown: {
    name: 'Deep Breathing',
    target_area: 'flexibility',
    simple_instruction: 'Sit comfortably. Breathe in slowly through your nose for 4 counts, hold for 2, breathe out for 4. Repeat 5 times.',
    duration_or_reps: '5 slow breaths',
  },
};

function inferContraindicationTags(exercise) {
  const text = `${exercise.name} ${exercise.target_area}`.toLowerCase();
  const tags = [];
  for (const [tag, keywords] of Object.entries(AREA_KEYWORDS_BY_TAG)) {
    if (keywords.some((k) => text.includes(k))) tags.push(tag);
  }
  return tags;
}

function violatesContraindications(exercise, medicalConditions) {
  if (!medicalConditions || medicalConditions.length === 0) return false;
  const tags = inferContraindicationTags(exercise);
  return tags.some((t) => medicalConditions.includes(t));
}

function isAcceptable(exercise, profile) {
  return isExerciseSafe(exercise) && !violatesContraindications(exercise, profile.medical_conditions);
}

// Validates one exercise slot, regenerating once via Gemini if it fails the
// safety blocklist or contraindication check, then substituting a hardcoded
// safe default if the retry also fails - never asks Gemini a third time.
async function ensureSafeExercise(exercise, profile, sessionRole, excludeNames) {
  if (isAcceptable(exercise, profile)) return { ...exercise, source: 'gemini' };

  try {
    const replacement = await regenerateSingleExercise(profile, sessionRole, excludeNames);
    if (isAcceptable(replacement, profile)) return { ...replacement, source: 'gemini' };
  } catch (err) {
    console.warn(`Slot regeneration failed for role "${sessionRole}": ${err.message}`);
  }

  return { ...SAFE_DEFAULTS[sessionRole], session_role: sessionRole, source: 'fallback_text_only' };
}

async function applySafetyAndContraindications(rawPlan, profile) {
  const days = [];
  for (const day of rawPlan.plan) {
    const excludeNames = day.exercises.map((e) => e.name);
    const exercises = [];
    for (const exercise of day.exercises) {
      exercises.push(await ensureSafeExercise(exercise, profile, exercise.session_role, excludeNames));
    }
    days.push({ day_offset: day.day_offset, exercises });
  }
  return days;
}

async function validateYoutubeUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

// Resolves every unique exercise (by name) across the whole rotation to real
// media, checking exercise_catalog first so nothing is re-resolved on a
// future regeneration. Mutates nothing - returns a name -> media map.
async function resolveMediaForPlan(days) {
  const uniqueByName = new Map();
  for (const day of days) {
    for (const exercise of day.exercises) {
      if (!uniqueByName.has(exercise.name)) uniqueByName.set(exercise.name, exercise);
    }
  }

  const mediaByName = new Map();

  for (const [name, exercise] of uniqueByName) {
    const { rows } = await pool.query(
      'select gif_url, video_media_id, video_url, source from exercise_catalog where lower(name) = lower($1) limit 1',
      [name]
    );
    if (rows[0]?.gif_url) {
      // The catalog row's video_media_id was valid when first resolved, but
      // WhatsApp media IDs expire (~30 days) - re-check media_cache rather
      // than trusting a possibly-stale id forever. getOrUploadMediaId already
      // re-uploads and refreshes the cache if the entry is missing/expired.
      try {
        const freshMediaId = await getOrUploadMediaId(rows[0].gif_url);
        mediaByName.set(name, { ...rows[0], video_media_id: freshMediaId });
      } catch (err) {
        console.warn(`Media refresh failed for "${name}", reusing possibly-stale id: ${err.message}`);
        mediaByName.set(name, rows[0]);
      }
      continue;
    }
    if (rows[0]) {
      mediaByName.set(name, rows[0]);
      continue;
    }

    let gifUrl = null;
    let videoMediaId = null;
    let source = exercise.source;

    const match = await searchExercise(name);
    if (match?.gifUrl) {
      try {
        videoMediaId = await getOrUploadMediaId(match.gifUrl);
        gifUrl = match.gifUrl;
        source = 'workoutx';
      } catch (err) {
        console.warn(`Media upload failed for "${name}": ${err.message}`);
      }
    }

    const videoUrl = await validateYoutubeUrl(exercise.youtube_url);

    mediaByName.set(name, { gif_url: gifUrl, video_media_id: videoMediaId, video_url: videoUrl, source });
    await new Promise((resolve) => setTimeout(resolve, WORKOUTX_THROTTLE_MS));
  }

  return mediaByName;
}

// Upserts every unique exercise into exercise_catalog and returns a
// name -> catalog UUID map, used to build the rotation's daily_sequences.
async function saveExercisesToCatalog(days, mediaByName) {
  const uniqueByName = new Map();
  for (const day of days) {
    for (const exercise of day.exercises) {
      if (!uniqueByName.has(exercise.name)) uniqueByName.set(exercise.name, exercise);
    }
  }

  const idByName = new Map();
  for (const [name, exercise] of uniqueByName) {
    const media = mediaByName.get(name) || {};
    const contraindicationTags = inferContraindicationTags(exercise);

    const { rows } = await pool.query(
      `insert into exercise_catalog
         (name, session_role, target_area, simple_instruction, duration_or_reps,
          gif_url, video_media_id, video_url, source, contraindication_tags)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        name,
        exercise.session_role,
        exercise.target_area,
        exercise.simple_instruction,
        exercise.duration_or_reps,
        media.gif_url || null,
        media.video_media_id || null,
        media.video_url || null,
        media.source || exercise.source || 'gemini',
        JSON.stringify(contraindicationTags),
      ]
    );
    idByName.set(name, rows[0].id);
  }
  return idByName;
}

async function generateRotationPlan(recipient, numDays = ROTATION_DAYS) {
  const profile = {
    age: recipient.age,
    height_cm: recipient.height_cm,
    weight_kg: recipient.weight_kg,
    activity_level: recipient.activity_level,
    medical_conditions: recipient.medical_conditions || [],
  };

  const rawPlan = await generateMultiWeekPlan(profile, numDays);
  const validatedDays = await applySafetyAndContraindications(rawPlan, profile);
  const mediaByName = await resolveMediaForPlan(validatedDays);
  const idByName = await saveExercisesToCatalog(validatedDays, mediaByName);

  const dailySequences = validatedDays.map((day) => ({
    day_offset: day.day_offset,
    exercise_ids: day.exercises.map((e) => idByName.get(e.name)),
  }));

  const { rows } = await pool.query(
    `insert into plan_rotations (care_recipient_id, generated_at, valid_until, daily_sequences, status)
     values ($1, now(), now() + interval '${numDays} days', $2, 'pending_review')
     returning *`,
    [recipient.id, JSON.stringify(dailySequences)]
  );

  return { rotation: rows[0], days: validatedDays, mediaByName };
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
  inferContraindicationTags,
};
