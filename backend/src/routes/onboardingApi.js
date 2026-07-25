const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { mapMedicalConditionsToTags } = require('../llm/gemini');
const { generateRotationPlan, approveRotation, swapExercise } = require('../services/planGeneration');
const { CONTRAINDICATION_TAGS } = require('../services/contraindicationTags');
const { sendInteractiveButtons } = require('../whatsapp/client');
const { logMessage } = require('../services/messageLog');

const router = express.Router();
router.use('/api/onboarding', requireAuth);

const E164_RE = /^\+[1-9]\d{6,14}$/;
const ACTIVITY_LEVELS = new Set(['not_active', 'somewhat_active', 'very_active']);
const GENDERS = new Set(['female', 'male', 'other']);
// v1's mobility_level is still required by the schema and still drives the
// no-rotation fallback path in planSelection.js - map the new caregiver-facing
// activity_level onto it once at creation rather than making two parallel
// "how active are they" fields the rest of the app has to reconcile.
const MOBILITY_LEVEL_BY_ACTIVITY = {
  not_active: 'low',
  somewhat_active: 'medium',
  very_active: 'high',
};

router.post(
  '/api/onboarding/map-conditions',
  asyncHandler(async (req, res) => {
    const { freeText } = req.body || {};
    if (!freeText || typeof freeText !== 'string') {
      return res.status(400).json({ error: 'freeText is required' });
    }
    const tags = await mapMedicalConditionsToTags(freeText, CONTRAINDICATION_TAGS);
    res.json({ tags });
  })
);

router.post(
  '/api/onboarding/create-recipient',
  asyncHandler(async (req, res) => {
    const {
      name, phoneNumber, age, gender, heightCm, weightKg, activityLevel,
      medicalConditions, preferredTime, timezone, consentGiven,
    } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!phoneNumber || !E164_RE.test(phoneNumber)) {
      return res.status(400).json({ error: 'phoneNumber must be in E.164 format, e.g. +15551234567' });
    }
    if (!Number.isInteger(age) || age <= 0) {
      return res.status(400).json({ error: 'age must be a positive integer' });
    }
    if (!GENDERS.has(gender)) {
      return res.status(400).json({ error: 'gender must be one of female, male, other' });
    }
    if (!ACTIVITY_LEVELS.has(activityLevel)) {
      return res.status(400).json({ error: 'activityLevel must be one of not_active, somewhat_active, very_active' });
    }
    if (!preferredTime || typeof preferredTime !== 'string') {
      return res.status(400).json({ error: 'preferredTime is required' });
    }
    if (!timezone || typeof timezone !== 'string') {
      return res.status(400).json({ error: 'timezone is required' });
    }
    if (consentGiven !== true) {
      return res.status(400).json({ error: 'consentGiven must be explicitly true - cannot save without it' });
    }

    const tags = Array.isArray(medicalConditions) ? medicalConditions : [];
    const allowedTags = new Set(CONTRAINDICATION_TAGS);
    const invalidTag = tags.find((t) => !allowedTags.has(t));
    if (invalidTag) {
      return res.status(400).json({ error: `Unknown medical condition tag: ${invalidTag}` });
    }

    try {
      const { rows } = await pool.query(
        `insert into care_recipients
           (name, phone_number, age, gender, height_cm, weight_kg, activity_level, mobility_level,
            medical_conditions, preferred_time, timezone, consent_given, consent_given_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now())
         returning *`,
        [
          name, phoneNumber, age, gender, heightCm || null, weightKg || null, activityLevel,
          MOBILITY_LEVEL_BY_ACTIVITY[activityLevel], JSON.stringify(tags), preferredTime, timezone,
        ]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'care_recipients_phone_number_key') {
        return res.status(409).json({ error: 'A recipient with this phone number already exists' });
      }
      throw err;
    }
  })
);

// Returns the most recent rotation for a recipient (pending_review or active,
// whichever is newest) plus the full exercise details for every ID it
// references - so PlanReview can render names/instructions/media without a
// separate round trip, and still works on a page reload (not just right
// after generation).
router.get(
  '/api/onboarding/recipients/:recipientId/rotation',
  asyncHandler(async (req, res) => {
    const { rows: rotationRows } = await pool.query(
      `select * from plan_rotations where care_recipient_id = $1
       order by generated_at desc limit 1`,
      [req.params.recipientId]
    );
    const rotation = rotationRows[0];
    if (!rotation) return res.status(404).json({ error: 'No plan generated yet for this recipient' });

    const ids = [...new Set(rotation.daily_sequences.flatMap((d) => d.exercise_ids))];
    const { rows: exerciseRows } = await pool.query(
      'select * from exercise_catalog where id = any($1::uuid[])',
      [ids]
    );
    const exercisesById = Object.fromEntries(exerciseRows.map((e) => [e.id, e]));

    res.json({ rotation, exercisesById });
  })
);

router.post(
  '/api/onboarding/generate-plan/:recipientId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('select * from care_recipients where id = $1', [req.params.recipientId]);
    const recipient = rows[0];
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const result = await generateRotationPlan(recipient);
    res.json(result);
  })
);

router.put(
  '/api/onboarding/plan/:rotationId/swap',
  asyncHandler(async (req, res) => {
    const { dayOffset, exerciseIndex, newExerciseId } = req.body || {};
    if (
      !Number.isInteger(dayOffset) ||
      !Number.isInteger(exerciseIndex) ||
      !newExerciseId
    ) {
      return res.status(400).json({ error: 'dayOffset, exerciseIndex, and newExerciseId are required' });
    }
    const rotation = await swapExercise(req.params.rotationId, dayOffset, exerciseIndex, newExerciseId);
    res.json(rotation);
  })
);

router.post(
  '/api/onboarding/plan/:rotationId/approve',
  asyncHandler(async (req, res) => {
    const rotation = await approveRotation(req.params.rotationId);
    if (!rotation) return res.status(404).json({ error: 'Rotation not found' });
    res.json(rotation);
  })
);

router.post(
  '/api/onboarding/send-test/:recipientId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('select * from care_recipients where id = $1', [req.params.recipientId]);
    const recipient = rows[0];
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const body = `Hi ${recipient.name}! This is a test message from your exercise reminder service - just confirming everything's set up correctly.`;

    try {
      const messageId = await sendInteractiveButtons(recipient.phone_number, body, [{ id: 'yes', title: 'Got it!' }]);
      await logMessage({ careRecipientId: recipient.id, direction: 'out', body, whatsappMessageId: messageId });
      res.json({ sent: true });
    } catch (err) {
      // Surface WhatsApp delivery failures as a clear message rather than a
      // raw 500 - this is a real caregiver-facing action, not an internal
      // error. Also actually log the failure (previously this route never
      // called logMessage at all, so a failed test send left no trace).
      console.warn(`Test message send failed for ${recipient.phone_number}: ${err.message}`);
      await logMessage({ careRecipientId: recipient.id, direction: 'out', body, sendFailed: true });

      // Error 131047 specifically means the recipient has never messaged this
      // WhatsApp number first - free-form messages (including this test one)
      // are only allowed within 24h of the customer initiating contact.
      if (err.message.includes('131047')) {
        return res.status(502).json({
          error: `WhatsApp blocked this message because ${recipient.name} hasn't messaged this WhatsApp number yet. Have them send any message (e.g. "Hi") to the number first, then try again.`,
        });
      }
      res.status(502).json({ error: `WhatsApp delivery failed: ${err.message}` });
    }
  })
);

router.get(
  '/api/onboarding/catalog',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('select * from exercise_catalog order by name');
    res.json(rows);
  })
);

router.get(
  '/api/onboarding/catalog/filtered/:recipientId',
  asyncHandler(async (req, res) => {
    const { rows: recipientRows } = await pool.query(
      'select medical_conditions from care_recipients where id = $1',
      [req.params.recipientId]
    );
    const recipient = recipientRows[0];
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const conditions = recipient.medical_conditions || [];
    const { rows } = await pool.query('select * from exercise_catalog order by name');
    const safe = rows.filter((exercise) => {
      const tags = exercise.contraindication_tags || [];
      return !tags.some((t) => conditions.includes(t));
    });
    res.json(safe);
  })
);

module.exports = router;
