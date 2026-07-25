// Client for the WorkoutX exercise API (https://workoutxapp.com) - free tier,
// 500 req/month, 30/min. Used to resolve a Gemini-proposed exercise name to a
// real, hosted demo GIF.
//
// Found while spiking this integration (see README gotcha):
// - `name` search is an exact substring match, not fuzzy/tokenized - and the
//   dataset is a general gym-equipment catalog (Barbell/Cable/Lever variants
//   dominate), not senior-friendly plain names. Multi-word queries like
//   "seated marching" or "chair sit to stand" almost always return zero
//   results, even though the underlying movement exists under a different
//   name. So we try the full proposed name first, then each remaining
//   significant word (positional/equipment qualifiers stripped) in turn.
// - Combining multiple filters (bodyPart + difficulty, etc.) tends to return
//   zero results even for common exercises - avoid stacking filters in the
//   query itself; filter client-side instead.
// - Candidates are HARD-filtered to beginner + bodyweight + non-plyometric +
//   non-vigorous, not just scored - per the brief, a wrong/mismatched demo
//   (e.g. an intermediate cable-machine exercise standing in for a simple
//   seated stretch) is worse than no demo at all, so a weak match is
//   rejected outright rather than picked as "best of a bad bunch."
// - The free tier's gifUrl requires our own API key to fetch (401 without it) -
//   the actual GIF bytes are downloaded by whatsapp/mediaCache.js, not here.

const BASE_URL = 'https://api.workoutxapp.com/v1';

const QUALIFIER_WORDS = new Set([
  'seated', 'sitting', 'standing', 'chair', 'wall', 'supported', 'assisted',
  'the', 'a', 'an', 'of', 'for', 'with', 'in', 'to', 'on', 'each', 'both',
  'single', 'double', 'gentle', 'slow', 'simple',
]);

// Words long/specific enough to be treated as "meaningful" - short generic
// fragments like "up", "in", "on" are too weak a signal that a match is
// actually the same exercise (see nameMatches below).
const MIN_MEANINGFUL_LENGTH = 4;

function significantWords(name) {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .split(/[\s-]+/)
    .filter((w) => w && !QUALIFIER_WORDS.has(w));
}

// One extra query attempt: the name with positional/equipment qualifiers
// stripped but still joined as a single phrase (not exploded into individual
// words - single generic words like "push" or "ups" match too many unrelated
// exercises, see README gotcha).
function qualifierStrippedPhrase(name) {
  const words = significantWords(name);
  return words.length > 0 ? words.join(' ') : null;
}

// Guards against a candidate that happens to be "qualified" (beginner,
// bodyweight) but is actually a completely different exercise that the
// substring search coincidentally matched (e.g. "Wall Push-ups" -> "Butt-ups"
// via a generic "ups" fragment). Requires at least one meaningful word
// in common with the original proposed name.
function nameMatches(candidateName, originalWords) {
  const candidateLower = candidateName.toLowerCase();
  return originalWords.some(
    (w) => w.length >= MIN_MEANINGFUL_LENGTH && candidateLower.includes(w)
  );
}

function isQualified(candidate) {
  return (
    candidate.difficulty === 'beginner' &&
    candidate.equipment === 'Body Weight' &&
    candidate.category !== 'plyometric' &&
    candidate.intensity_level !== 'vigorous'
  );
}

// Among already-qualified candidates, prefer ones explicitly tagged friendly
// for this population - just a tie-breaker, not a safety gate (isQualified
// already handled safety).
function preferenceScore(candidate) {
  const tags = candidate.movement_tags || [];
  let score = 0;
  if (tags.includes('beginner-friendly')) score += 1;
  if (tags.includes('joint-friendly')) score += 1;
  if (tags.includes('low-intensity')) score += 1;
  return score;
}

async function fetchWithRetry(url, options, retriesLeft = 1) {
  const res = await fetch(url, options);
  if (res.status === 429 && retriesLeft > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fetchWithRetry(url, options, retriesLeft - 1);
  }
  return res;
}

async function queryByName(query, apiKey) {
  const url = `${BASE_URL}/exercises?name=${encodeURIComponent(query)}&limit=10`;
  const res = await fetchWithRetry(url, { headers: { 'X-WorkoutX-Key': apiKey } });
  if (!res.ok) {
    console.warn(`WorkoutX search failed for "${query}": ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data?.data || [];
}

// Returns the best-matching, safety-qualified exercise record from WorkoutX
// for a given name, or null if nothing qualified was found (or on any
// failure) - callers must treat null as "no media available for this
// exercise" and fall back to text-only, never retry indefinitely.
async function searchExercise(name) {
  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) {
    console.warn('WORKOUTX_API_KEY not set - skipping media resolution');
    return null;
  }

  const originalWords = significantWords(name);
  const stripped = qualifierStrippedPhrase(name);
  const queries = stripped && stripped !== name.toLowerCase() ? [name, stripped] : [name];

  try {
    for (const query of queries) {
      const candidates = await queryByName(query, apiKey);
      const matches = candidates.filter(
        (c) => isQualified(c) && nameMatches(c.name, originalWords)
      );
      if (matches.length > 0) {
        return matches.reduce((a, b) => (preferenceScore(b) > preferenceScore(a) ? b : a));
      }
    }
    return null;
  } catch (err) {
    console.warn(`WorkoutX search error for "${name}": ${err.message}`);
    return null;
  }
}

module.exports = { searchExercise };
