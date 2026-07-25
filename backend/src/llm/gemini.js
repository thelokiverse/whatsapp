const { GoogleGenAI } = require('@google/genai');

const MODEL = 'gemini-2.5-flash';

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
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
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

module.exports = { selectExercisesWithLLM };
