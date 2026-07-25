const { GoogleGenAI } = require('@google/genai');
const { CONTRAINDICATION_TAGS } = require('../services/contraindicationTags');

const MODEL = 'gemini-3.5-flash';

function client() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function buildPrompt(profile, filteredExercises, recentHistory) {
  return `You are selecting exercises for a senior citizen's daily low-impact exercise routine.

Person's profile:
${JSON.stringify(profile)}

Allowed exercises (already filtered to exclude anything contraindicated for this person):
${JSON.stringify(filteredExercises)}

Exercise IDs used in their last 2 days (avoid repeating these if possible):
${JSON.stringify(recentHistory)}

Select exactly 3 to 4 exercises from the allowed list above that:
- give a balanced mix of areas (legs/arms/balance/flexibility/cardio)
- are appropriate for mobility_level = "${profile.mobility_level}"
- are NOT identical to the exercises used in the last 2 days, if avoidable

Return ONLY a JSON array of exercise ID strings from the allowed list. Do not invent new
exercises or IDs, and do not include anything not in the allowed list.`;
}

// Returns a raw (unvalidated) array of candidate exercise IDs from the LLM.
// Caller is responsible for validating against the filtered list and falling
// back on any failure - this function does not retry.
async function selectExercisesWithLLM(profile, filteredExercises, recentHistory) {
  const response = await client().models.generateContent({
    model: MODEL,
    contents: buildPrompt(profile, filteredExercises, recentHistory),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  });

  return JSON.parse(response.text);
}

const EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    session_role: { type: 'string', enum: ['warmup', 'main', 'cooldown'] },
    target_area: { type: 'string' },
    simple_instruction: { type: 'string' },
    duration_or_reps: { type: 'string' },
    youtube_url: { type: 'string' },
  },
  required: ['name', 'session_role', 'target_area', 'simple_instruction', 'duration_or_reps'],
};

const SAFETY_RULES = `Safety rules - these are absolute, non-negotiable constraints:
- No jumping, plyometric, or explosive movements of any kind.
- No floor get-ups or any exercise that requires getting up from lying on the floor
  without a chair/support to push off from.
- No heavy free weights (barbells, heavy dumbbells) - bodyweight, light resistance
  bands, or a light household object (e.g. a water bottle) only.
- No high-impact cardio (running, jogging, sprinting, jump rope).
- Every exercise must be doable seated, standing with chair/wall support, or lying
  on a bed - appropriate for a frail-to-average-fitness older adult.`;

function buildMultiWeekPrompt(profile, numDays) {
  return `You are designing a ${numDays}-day low-impact exercise rotation for a senior citizen.

Person's profile:
${JSON.stringify(profile)}

Contraindication tags to strictly avoid triggering (do not propose any exercise that would
stress or load an area affected by these): ${JSON.stringify(profile.medical_conditions || [])}

${SAFETY_RULES}

Structure requirements:
- Each day needs exactly 1 "warmup" exercise, 2 to 3 "main" exercises, and 1 "cooldown" exercise.
- Rotate target areas across days (legs/arms/shoulders/core/balance/flexibility/cardio/back/neck)
  rather than repeating the same focus every day.
- Avoid using the identical set of exercises on consecutive days.
- session_role must be one of exactly: warmup, main, cooldown.
- For youtube_url, only include it if you are confident a real, existing YouTube video at
  that exact URL demonstrates this exercise - otherwise omit the field. Never invent a
  plausible-looking URL; a missing field is fine and expected.

Return the full ${numDays}-day plan as structured JSON.`;
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day_offset: { type: 'integer' },
          exercises: { type: 'array', items: EXERCISE_SCHEMA },
        },
        required: ['day_offset', 'exercises'],
      },
    },
  },
  required: ['plan'],
};

// Returns { plan: [{ day_offset, exercises: [...] }] } - raw and unvalidated.
// Caller (planGeneration.js) runs this through the deterministic safety
// blocklist and contraindication check before anything is saved or sent.
async function generateMultiWeekPlan(profile, numDays = 28) {
  const response = await client().models.generateContent({
    model: MODEL,
    contents: buildMultiWeekPrompt(profile, numDays),
    config: {
      responseMimeType: 'application/json',
      responseSchema: PLAN_SCHEMA,
    },
  });

  return JSON.parse(response.text);
}

// One replacement exercise for a single slot that failed the safety blocklist
// or contraindication check. Capped at 1 retry by the caller - if this also
// fails, the caller substitutes a hardcoded safe default rather than asking
// Gemini again indefinitely.
async function regenerateSingleExercise(profile, sessionRole, excludeNames) {
  const prompt = `You are choosing one replacement exercise for a senior citizen's exercise
routine. The previous suggestion for this slot was rejected as unsafe.

Person's profile: ${JSON.stringify(profile)}
Contraindication tags to avoid: ${JSON.stringify(profile.medical_conditions || [])}
This slot's role: "${sessionRole}"
Do not suggest any of these (already rejected or already used today): ${JSON.stringify(excludeNames)}

${SAFETY_RULES}

Return exactly one exercise as structured JSON.`;

  const response = await client().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: EXERCISE_SCHEMA,
    },
  });

  return JSON.parse(response.text);
}

// Maps a caregiver's free-text medical description to the controlled
// contraindication-tag vocabulary. The LLM may only select from tagVocabulary
// - never invent a new tag. The caregiver always reviews/edits the result
// before it's saved (see onboardingApi.js) - this is a safety-critical field.
async function mapMedicalConditionsToTags(freeText, tagVocabulary = CONTRAINDICATION_TAGS) {
  const prompt = `A caregiver described a senior citizen's medical conditions in their own words:

"${freeText}"

Controlled tag vocabulary (select only from this list, do not invent new tags):
${JSON.stringify(tagVocabulary)}

Return a JSON array of every tag from the vocabulary that plausibly applies, based on the
free-text description. If nothing plausibly applies, return an empty array.`;

  const response = await client().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'array', items: { type: 'string' } },
    },
  });

  const tags = JSON.parse(response.text);
  // Belt-and-suspenders: even though the schema/prompt constrain to the
  // vocabulary, strip anything that isn't actually in it before returning.
  const allowed = new Set(tagVocabulary);
  return tags.filter((t) => allowed.has(t));
}

module.exports = {
  selectExercisesWithLLM,
  generateMultiWeekPlan,
  regenerateSingleExercise,
  mapMedicalConditionsToTags,
};
