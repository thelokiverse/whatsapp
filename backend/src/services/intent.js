const YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'y', 'ready', 'start'];
const DONE_WORDS = ['done', 'finished', 'finish', 'complete', 'completed', 'd'];
const SKIP_WORDS = ['skip', 'pass', 'next', 'no'];

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

function matchesWordList(normalizedText, words) {
  if (words.includes(normalizedText)) return true;
  // Forgive small typos, but only for short replies (a whole sentence
  // shouldn't fuzzy-match a one-word command just by chance).
  if (normalizedText.length > 0 && normalizedText.length <= 10) {
    return words.some((word) => levenshtein(normalizedText, word) <= 1);
  }
  return false;
}

function classifyIntent(text) {
  const normalized = normalize(text || '');
  if (matchesWordList(normalized, YES_WORDS)) return 'YES';
  if (matchesWordList(normalized, DONE_WORDS)) return 'DONE';
  if (matchesWordList(normalized, SKIP_WORDS)) return 'SKIP';
  return 'UNKNOWN';
}

const BUTTON_ID_TO_INTENT = {
  yes: 'YES',
  not_now: 'NOT_NOW',
  done: 'DONE',
  skip: 'SKIP',
  watch_video: 'WATCH_VIDEO',
};

// Button replies are a reliable id from WhatsApp, not free text - no fuzzy
// matching needed, just a direct lookup.
function intentFromButtonId(buttonId) {
  return BUTTON_ID_TO_INTENT[buttonId] || 'UNKNOWN';
}

module.exports = { classifyIntent, intentFromButtonId };
