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

// Structured output is a plain list of exercise IDs per day, in a fixed
// positional order: [warmup, warmup, main, main, cooldown]. Gemini can only
// select from the fixed CDC library passed into the prompt (see
// cdcExerciseLibrary.js and planGeneration.js) - it never generates exercise
// names, instructions, or media. This replaced an earlier design where
// Gemini freely generated exercise names to be matched against an external
// API, which had two real problems found during use with an actual elderly
// recipient: the matched media was often visually inappropriate/mismatched,
// and match rates were low given the mismatch between AI-generated names and
// the external dataset's naming/content.
const DAY_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    day_offset: { type: 'integer' },
    exercise_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['day_offset', 'exercise_ids'],
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'array', items: DAY_PLAN_SCHEMA },
  },
  required: ['plan'],
};

function buildSelectionPrompt(profile, warmups, mains, cooldowns, numDays) {
  return `You are sequencing a ${numDays}-day exercise rotation for a senior citizen, selecting
ONLY from a fixed, pre-approved exercise library - you may not invent, rename, or modify any
exercise, only choose which ones to use each day and in what order.

Person's profile:
${JSON.stringify(profile)}

Available warmup exercises (already filtered to exclude anything contraindicated for this
person):
${JSON.stringify(warmups)}

Available main exercises (already filtered):
${JSON.stringify(mains)}

Available cooldown exercises (already filtered):
${JSON.stringify(cooldowns)}

For each of the ${numDays} days, choose exactly:
- 2 warmup exercise IDs (from the warmup list above)
- 2 main exercise IDs (from the main list above, no duplicates within the same day)
- 1 cooldown exercise ID (from the cooldown list above)

Return exercise_ids as an array of exactly 5 IDs in this exact order: [warmup, warmup, main,
main, cooldown]. Rotate which exercises are chosen across days for variety (considering the
person's age/height/weight/activity level), rather than repeating the identical set every
day, though some repetition is expected given the small fixed library. Every ID must come
from the lists above - never invent a new ID.`;
}

// Returns { plan: [{ day_offset, exercise_ids: [w, w, m, m, c] }] } - raw and
// unvalidated. Caller (planGeneration.js) validates every ID actually exists
// in the allowed, contraindication-filtered library and falls back to a
// deterministic round-robin rotation if the response is malformed - this
// function does not retry.
async function selectCdcPlan(profile, warmups, mains, cooldowns, numDays = 28) {
  const response = await client().models.generateContent({
    model: MODEL,
    contents: buildSelectionPrompt(profile, warmups, mains, cooldowns, numDays),
    config: {
      responseMimeType: 'application/json',
      responseSchema: PLAN_SCHEMA,
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
  selectCdcPlan,
  mapMedicalConditionsToTags,
};
