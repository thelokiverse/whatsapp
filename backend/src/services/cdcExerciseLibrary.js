// Fixed, hand-curated exercise library sourced from the CDC's "Growing
// Stronger: Strength Training for Older Adults" program. Replaces the
// WorkoutX-based approach (see README gotcha) for two reasons found during
// real use with an actual elderly recipient:
//   1. WorkoutX's demo GIFs feature a heavily-built bodybuilder model -
//      discouraging and unrelatable for this audience, and occasionally
//      mismatched to the text instructions (e.g. a standing/floor variation
//      shown for an exercise described as seated).
//   2. WorkoutX's fuzzy name-matching only found a real match ~15-25% of the
//      time, given its gym-equipment-skewed dataset.
//
// These 22 GIFs are U.S. government works (public domain), hosted on
// Wikimedia Commons, filmed with actual older-adult demonstrators, and
// require no API key or rate limit. Because the set is small and fixed,
// Gemini now SELECTS AND SEQUENCES from this list (like v1's original
// design) rather than freely generating exercise names to be matched
// against an external API - eliminating the matching-accuracy problem
// entirely, not just working around it.
//
// "Floor back extensions" and "Grip strength" from the original 22-file CDC
// set are deliberately excluded: floor back extensions requires getting
// down onto and up from the floor, which conflicts with this project's own
// safety rule (no floor exercises without chair/support to push off from);
// grip strength has no clear session role (warmup/main/cooldown) and reads
// more like an assessment than a daily exercise.

const WIKIMEDIA_BASE = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

function gifUrl(filename) {
  return `${WIKIMEDIA_BASE}${filename}-CDC_strength_training_for_older_adults.gif`;
}

const CDC_EXERCISES = [
  // Warmup - gentle, dynamic movement, no static holding
  {
    id: 'cdc_toe_stand',
    name: 'Toe Stand',
    session_role: 'warmup',
    target_area: 'balance',
    simple_instruction: 'Stand behind a sturdy chair, holding the back with both hands. Slowly rise up onto your toes, hold briefly, then lower back down.',
    duration_or_reps: '8-10 repetitions',
    contraindication_tags: ['balance_disorder', 'severe_vertigo'],
    gifFile: 'Toe_stand',
  },
  {
    id: 'cdc_finger_marching',
    name: 'Finger Marching',
    session_role: 'warmup',
    target_area: 'hands',
    simple_instruction: 'Sit comfortably. "Walk" your fingers up a wall or your own thigh, one at a time, then walk them back down. Gentle warmup for hands and shoulders.',
    duration_or_reps: '30 seconds each hand',
    contraindication_tags: [],
    gifFile: 'Finger_marching',
  },
  {
    id: 'cdc_pelvic_tilt',
    name: 'Pelvic Tilt',
    session_role: 'warmup',
    target_area: 'core',
    simple_instruction: 'Stand with your back against a wall, knees slightly bent. Gently flatten your lower back against the wall by tightening your stomach muscles, hold briefly, then relax.',
    duration_or_reps: '8-10 repetitions',
    contraindication_tags: ['recent_back_surgery', 'back_pain'],
    gifFile: 'Pelvic_tilt',
  },

  // Main - strength exercises
  {
    id: 'cdc_biceps_curl',
    name: 'Biceps Curl',
    session_role: 'main',
    target_area: 'arms',
    simple_instruction: 'Sit or stand holding a light weight (or a filled water bottle) in each hand, arms at your sides, palms facing forward. Slowly bend your elbows to bring your hands toward your shoulders, then lower.',
    duration_or_reps: '2 sets of 10-12 reps',
    contraindication_tags: [],
    gifFile: 'Biceps_curl',
  },
  {
    id: 'cdc_chest_press',
    name: 'Chest Press',
    session_role: 'main',
    target_area: 'chest',
    simple_instruction: 'Sit tall in a sturdy chair holding light weights at chest height, elbows out to the sides. Push your hands forward until your arms are extended, then slowly bring them back.',
    duration_or_reps: '2 sets of 10 reps',
    contraindication_tags: ['shoulder_injury'],
    gifFile: 'Chest_press',
  },
  {
    id: 'cdc_hip_abduction',
    name: 'Hip Abduction',
    session_role: 'main',
    target_area: 'hips',
    simple_instruction: 'Stand behind a sturdy chair, holding the back for support. Slowly lift one leg out to the side, keeping your body straight, then lower it back down. Switch legs.',
    duration_or_reps: '8-10 reps per leg',
    contraindication_tags: ['hip_pain', 'recent_hip_surgery', 'balance_disorder'],
    gifFile: 'Hip_abduction',
  },
  {
    id: 'cdc_knee_curl',
    name: 'Knee Curl',
    session_role: 'main',
    target_area: 'legs',
    simple_instruction: 'Stand behind a sturdy chair, holding the back for support. Slowly bend one knee, bringing your heel up toward your buttocks, then lower it back down. Switch legs.',
    duration_or_reps: '8-10 reps per leg',
    contraindication_tags: ['knee_pain', 'severe_knee_pain', 'balance_disorder'],
    gifFile: 'Knee_curl',
  },
  {
    id: 'cdc_knee_extension',
    name: 'Knee Extension',
    session_role: 'main',
    target_area: 'legs',
    simple_instruction: 'Sit tall in a sturdy chair. Slowly straighten one knee until your leg is out in front of you, hold briefly, then lower it back down. Switch legs.',
    duration_or_reps: '8-10 reps per leg',
    contraindication_tags: ['knee_pain', 'severe_knee_pain'],
    gifFile: 'Knee_extension',
  },
  {
    id: 'cdc_lunge',
    name: 'Supported Lunge',
    session_role: 'main',
    target_area: 'legs',
    simple_instruction: 'Stand holding the back of a sturdy chair with both hands for balance. Step one foot forward and gently bend both knees, then push back to standing. Switch legs.',
    duration_or_reps: '6-8 reps per leg',
    contraindication_tags: ['knee_pain', 'severe_knee_pain', 'balance_disorder', 'hip_pain', 'recent_hip_surgery'],
    gifFile: 'Lunge',
  },
  {
    id: 'cdc_overhead_press',
    name: 'Overhead Press',
    session_role: 'main',
    target_area: 'shoulders',
    simple_instruction: 'Sit tall holding light weights at shoulder height, palms facing forward. Slowly push your hands straight up overhead, then lower back to shoulder height.',
    duration_or_reps: '2 sets of 10 reps',
    contraindication_tags: ['shoulder_injury'],
    gifFile: 'Overhead_press',
  },
  {
    id: 'cdc_squat',
    name: 'Chair Squat',
    session_role: 'main',
    target_area: 'legs',
    simple_instruction: 'Stand in front of a sturdy chair, feet shoulder-width apart. Slowly bend your knees and lower yourself as if sitting down, tapping the chair lightly, then stand back up.',
    duration_or_reps: '8-10 reps',
    contraindication_tags: ['knee_pain', 'severe_knee_pain', 'hip_pain'],
    gifFile: 'Squat',
  },
  {
    id: 'cdc_step_up',
    name: 'Step Up',
    session_role: 'main',
    target_area: 'legs',
    simple_instruction: 'Stand at the base of a sturdy step, holding a rail or wall for balance. Step up with one foot, bring the other up to meet it, then step back down. Lead with the other leg next time.',
    duration_or_reps: '6-8 reps per leg',
    contraindication_tags: ['balance_disorder', 'knee_pain', 'severe_knee_pain', 'hip_pain'],
    gifFile: 'Step_up',
  },
  {
    id: 'cdc_upward_row',
    name: 'Upward Row',
    session_role: 'main',
    target_area: 'back',
    simple_instruction: 'Stand holding light weights in front of your thighs. Slowly raise your hands up toward your chin, leading with your elbows, then lower back down.',
    duration_or_reps: '2 sets of 10 reps',
    contraindication_tags: ['shoulder_injury'],
    gifFile: 'Upward_row',
  },
  {
    id: 'cdc_wall_pushup',
    name: 'Wall Push-up',
    session_role: 'main',
    target_area: 'chest',
    simple_instruction: "Stand facing a wall, arm's length away. Place your palms on the wall at shoulder height. Bend your elbows to bring your chest toward the wall, then push back.",
    duration_or_reps: '8-10 reps',
    contraindication_tags: ['shoulder_injury'],
    gifFile: 'Wallpushup',
  },
  {
    id: 'cdc_abdominal_curl',
    name: 'Abdominal Curl',
    session_role: 'main',
    target_area: 'core',
    simple_instruction: 'Sit tall in a sturdy chair, hands resting on your thighs. Gently tighten your stomach muscles and curl your upper body slightly forward, hold briefly, then release.',
    duration_or_reps: '8-10 reps',
    contraindication_tags: ['recent_back_surgery', 'back_pain'],
    gifFile: 'Abdominal_curl',
  },

  // Cooldown - static stretches
  {
    id: 'cdc_back_stretch',
    name: 'Back Stretch',
    session_role: 'cooldown',
    target_area: 'back',
    simple_instruction: 'Sit tall in a chair. Gently lean forward from your hips, reaching your hands toward your knees or shins, feeling a light stretch along your back. Hold, then sit back up slowly.',
    duration_or_reps: 'Hold 15-20 seconds',
    contraindication_tags: ['recent_back_surgery', 'back_pain'],
    gifFile: 'Backstretch',
  },
  {
    id: 'cdc_chest_stretch',
    name: 'Chest Stretch',
    session_role: 'cooldown',
    target_area: 'chest',
    simple_instruction: 'Sit or stand tall. Clasp your hands behind your back and gently lift them slightly, opening your chest. Hold, then release.',
    duration_or_reps: 'Hold 15-20 seconds',
    contraindication_tags: ['shoulder_injury'],
    gifFile: 'Chest_stretch',
  },
  {
    id: 'cdc_hamstring_stretch',
    name: 'Hamstring Stretch',
    session_role: 'cooldown',
    target_area: 'legs',
    simple_instruction: 'Sit at the edge of a sturdy chair. Extend one leg out in front of you, heel on the floor, toes pointing up. Gently lean forward from your hips until you feel a light stretch behind your thigh.',
    duration_or_reps: 'Hold 15-20 seconds per leg',
    contraindication_tags: [],
    gifFile: 'Hamstring_stretch',
  },
  {
    id: 'cdc_quad_stretch',
    name: 'Quad Stretch',
    session_role: 'cooldown',
    target_area: 'legs',
    simple_instruction: 'Stand holding the back of a sturdy chair for balance. Bend one knee, bringing your heel toward your buttocks, and hold your ankle gently with your hand. Hold, then switch legs.',
    duration_or_reps: 'Hold 15-20 seconds per leg',
    contraindication_tags: ['knee_pain', 'severe_knee_pain', 'balance_disorder'],
    gifFile: 'Quad_stretch',
  },
];

// Resolves each exercise's stable Wikimedia URL from its filename at
// require-time - kept separate from the literal data above for readability.
for (const exercise of CDC_EXERCISES) {
  exercise.gif_url = gifUrl(exercise.gifFile);
  delete exercise.gifFile;
}

module.exports = { CDC_EXERCISES };
