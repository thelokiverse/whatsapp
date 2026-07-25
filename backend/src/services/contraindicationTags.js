// Controlled vocabulary of medical-condition safety tags. Never invented
// freely by the LLM - mapMedicalConditionsToTags() in llm/gemini.js may only
// select from this list, and the caregiver always confirms the mapped tags
// before they're saved (see onboardingApi.js). Exercises in exercise_catalog
// carry a subset of these in contraindication_tags for the safety filter.
const CONTRAINDICATION_TAGS = [
  'knee_pain',
  'severe_knee_pain',
  'hip_pain',
  'recent_hip_surgery',
  'shoulder_injury',
  'recent_back_surgery',
  'back_pain',
  'balance_disorder',
  'severe_vertigo',
  'cardiac_condition',
  'severe_cardiac_condition',
  'recent_neck_injury',
  'osteoporosis',
  'recent_surgery_other',
  'breathing_condition',
];

// Deterministic, keyword-based mapping from a contraindication tag to the
// area/name keywords that would trigger it. Used to infer contraindication_tags
// for a Gemini-generated exercise (which has no tags of its own) and to
// re-check the final plan against a recipient's conditions - per the brief,
// this is a real validation step, not just a prompt instruction. Deliberately
// coarse/conservative: a false-positive drop (regenerating a slot that was
// actually fine) is a far smaller risk than a false negative.
const AREA_KEYWORDS_BY_TAG = {
  knee_pain: ['knee'],
  severe_knee_pain: ['knee'],
  hip_pain: ['hip'],
  recent_hip_surgery: ['hip'],
  shoulder_injury: ['shoulder'],
  recent_back_surgery: ['back', 'spine', 'core'],
  back_pain: ['back', 'spine'],
  balance_disorder: ['balance'],
  severe_vertigo: ['balance', 'vertigo'],
  cardiac_condition: ['cardio'],
  severe_cardiac_condition: ['cardio'],
  recent_neck_injury: ['neck'],
  osteoporosis: ['jump', 'impact'],
  breathing_condition: ['cardio'],
};

module.exports = { CONTRAINDICATION_TAGS, AREA_KEYWORDS_BY_TAG };
