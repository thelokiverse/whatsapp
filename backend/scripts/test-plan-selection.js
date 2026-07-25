// Standalone unit test for Phase 4 exercise selection - no DB, no WhatsApp.
// Confirms contraindication filtering holds for several fake profiles, and
// that whatever comes back (LLM or fallback) is always safe and well-formed.
// Run before ever wiring this into the live message flow.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { filterByContraindications, pickExercisesForProfile } = require('../src/services/planSelection');

const { exercises } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../exercise-library.json'), 'utf8')
);

const FAKE_PROFILES = [
  {
    label: 'No restrictions, high mobility',
    mobility_level: 'high',
    medical_conditions: [],
  },
  {
    label: 'Knee pain + balance disorder, low mobility',
    mobility_level: 'low',
    medical_conditions: ['severe_knee_pain', 'balance_disorder'],
  },
  {
    label: 'Shoulder injury + recent back surgery, medium mobility',
    mobility_level: 'medium',
    medical_conditions: ['shoulder_injury', 'recent_back_surgery'],
  },
  {
    label: 'Heavily restricted, low mobility',
    mobility_level: 'low',
    medical_conditions: [
      'recent_hip_surgery',
      'recent_neck_injury',
      'shoulder_injury',
      'recent_back_surgery',
      'balance_disorder',
    ],
  },
];

function isSafe(exerciseId, medicalConditions) {
  const exercise = exercises.find((e) => e.id === exerciseId);
  const contraindications = exercise?.contraindications || [];
  return !contraindications.some((c) => medicalConditions.includes(c));
}

async function run() {
  let allPassed = true;

  for (const profile of FAKE_PROFILES) {
    console.log(`\n=== ${profile.label} ===`);
    console.log('medical_conditions:', profile.medical_conditions);

    const filtered = filterByContraindications(exercises, profile.medical_conditions);
    console.log(`Filtered library: ${filtered.length}/${exercises.length} exercises safe`);

    const selected = await pickExercisesForProfile(profile, exercises, []);
    console.log('Selected:', selected);

    const checks = [
      [selected.length === 0 || (selected.length >= 3 && selected.length <= 4), 'count is 0 or 3-4'],
      [new Set(selected).size === selected.length, 'no duplicates'],
      [selected.every((id) => isSafe(id, profile.medical_conditions)), 'all selected exercises are contraindication-safe'],
    ];

    for (const [passed, label] of checks) {
      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}`);
      if (!passed) allPassed = false;
    }
  }

  console.log(`\n${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

run();
