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

module.exports = { CONTRAINDICATION_TAGS };
