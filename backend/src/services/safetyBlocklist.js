// Pure, deterministic safety filter for Gemini-proposed exercises. No LLM, no DB,
// no network - this is the one thing in the plan-generation pipeline that never
// depends on a model's judgment. Per the brief: cheap to keep, and means the
// system doesn't rely entirely on Gemini's judgment plus a non-expert caregiver's
// visual review to catch a bad generation before it reaches an elderly user.

const DISALLOWED_TERMS = [
  'jump', 'jumping', 'plyometric', 'burpee', 'sprint', 'sprinting',
  'barbell', 'dumbbell', 'kettlebell', 'deadlift', 'heavy weight', 'heavy lifting',
  'lunge with weight', 'weighted lunge', 'box jump', 'squat jump', 'jump squat',
  'jump rope', 'high impact', 'high-impact', 'running', 'jogging', 'sprinting',
  'floor get-up', 'get up from the floor', 'get up off the floor', 'lie on the floor',
  'push-up on the floor', 'floor push-up',
];

function textOf(exercise) {
  return `${exercise.name || ''} ${exercise.simple_instruction || ''}`.toLowerCase();
}

function isExerciseSafe(exercise) {
  const text = textOf(exercise);
  return !DISALLOWED_TERMS.some((term) => text.includes(term));
}

// dayPlan: { day_offset, exercises: [...] }
function filterUnsafeExercises(dayPlan) {
  const safe = [];
  const blocked = [];
  for (const exercise of dayPlan.exercises || []) {
    if (isExerciseSafe(exercise)) {
      safe.push(exercise);
    } else {
      blocked.push(exercise);
    }
  }
  return { safe, blocked };
}

module.exports = { DISALLOWED_TERMS, isExerciseSafe, filterUnsafeExercises };
