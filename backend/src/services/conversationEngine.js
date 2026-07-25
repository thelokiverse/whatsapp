const { pool } = require('../config/db');
const { sendText, sendInteractiveButtons, sendVideo } = require('../whatsapp/client');
const { logMessage } = require('./messageLog');
const { classifyIntent, intentFromButtonId } = require('./intent');
const { selectExercisesForToday } = require('./planSelection');
const { localDateString, dateStringInTimezone, localTimeString, addDaysToDateString } = require('../utils/time');

const FOLLOWUP_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours
const CUTOFF_TIME = '21:30'; // no further nagging past this local time

async function sendAndLog(recipient, body) {
  const messageId = await sendText(recipient.phone_number, body);
  await logMessage({
    careRecipientId: recipient.id,
    direction: 'out',
    body,
    whatsappMessageId: messageId,
  });
  return messageId;
}

// header: optional { type: 'video', mediaId } - passed straight through to
// sendInteractiveButtons; omitted for exercises with no resolved media yet.
async function sendButtonsAndLog(recipient, body, buttons, header) {
  const messageId = await sendInteractiveButtons(recipient.phone_number, body, buttons, header);
  await logMessage({
    careRecipientId: recipient.id,
    direction: 'out',
    body,
    whatsappMessageId: messageId,
  });
  return messageId;
}

// exerciseId is either a v1 exercise_library text ID (e.g. "ex_01") or a v2
// exercise_catalog UUID - check catalog first (UUID-shaped IDs only exist
// there), fall back to the legacy library so old daily_plans keep resolving.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getExercise(exerciseId) {
  if (UUID_RE.test(exerciseId)) {
    const { rows } = await pool.query('select * from exercise_catalog where id = $1', [exerciseId]);
    if (rows[0]) {
      const row = rows[0];
      return {
        name: row.name,
        instruction_simple: row.simple_instruction,
        duration_or_reps: row.duration_or_reps,
        video_media_id: row.video_media_id,
        video_url: row.video_url,
      };
    }
  }

  const { rows } = await pool.query('select data from exercise_library where id = $1', [exerciseId]);
  return rows[0]?.data || null;
}

async function getActiveRotation(recipientId) {
  const { rows } = await pool.query(
    `select * from plan_rotations
     where care_recipient_id = $1 and status = 'active' and valid_until > now()
     order by generated_at desc limit 1`,
    [recipientId]
  );
  return rows[0] || null;
}

async function getTodayPlan(recipient) {
  const date = localDateString(recipient.timezone);
  const { rows } = await pool.query(
    'select * from daily_plans where care_recipient_id = $1 and date = $2',
    [recipient.id, date]
  );
  return rows[0] || null;
}

// Whole-day counting (not real elapsed time) so a rotation started at any
// time of day still lines up with day_offset 0, 1, 2, ... - matches how
// daily_plans.date already works (one row per calendar day, not per 24h).
function daysBetweenDateStrings(fromDateStr, toDateStr) {
  const from = Date.UTC(...fromDateStr.split('-').map(Number));
  const to = Date.UTC(...toDateStr.split('-').map(Number));
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

async function exerciseIdsForToday(recipient, todayStr) {
  const rotation = await getActiveRotation(recipient.id);
  if (rotation) {
    const generatedDateStr = dateStringInTimezone(rotation.generated_at, recipient.timezone);
    const dayOffset = daysBetweenDateStrings(generatedDateStr, todayStr) % 28;
    const day = rotation.daily_sequences.find((d) => d.day_offset === dayOffset);
    if (day) return day.exercise_ids;
  }
  // No active rotation (or offset not found) - fall back to the v1 LLM-selection path.
  return selectExercisesForToday(recipient);
}

async function createTodayPlan(recipient) {
  const date = localDateString(recipient.timezone);
  const exerciseIds = await exerciseIdsForToday(recipient, date);
  const { rows } = await pool.query(
    `insert into daily_plans (care_recipient_id, date, exercise_ids, status)
     values ($1, $2, $3, 'pending')
     returning *`,
    [recipient.id, date, JSON.stringify(exerciseIds)]
  );
  return rows[0];
}

async function sendInitialPrompt(recipient, plan) {
  const body = `Hi ${recipient.name}! Time for your evening exercises. Ready to start?`;
  await sendButtonsAndLog(recipient, body, [
    { id: 'yes', title: "Yes, let's go" },
    { id: 'not_now', title: 'Not now' },
  ]);
  const { rows } = await pool.query(
    `update daily_plans set status = 'sent', prompt_sent_at = now() where id = $1 returning *`,
    [plan.id]
  );
  return rows[0];
}

async function sentExerciseCount(planId) {
  const { rows } = await pool.query('select count(*) from session_logs where daily_plan_id = $1', [planId]);
  return Number(rows[0].count);
}

async function sendExerciseAtIndex(recipient, plan, index) {
  const exerciseId = plan.exercise_ids[index];
  const exercise = await getExercise(exerciseId);

  const body = `${exercise.name}\n${exercise.instruction_simple}\n${exercise.duration_or_reps}.`;
  // video_media_id only exists for exercise_catalog rows resolved via WorkoutX
  // (Phase 7) - legacy exercise_library rows never have one, so the header is
  // omitted and the message ships text-only, exactly as designed.
  const header = exercise.video_media_id
    ? { type: 'video', mediaId: exercise.video_media_id }
    : undefined;

  await sendButtonsAndLog(
    recipient,
    body,
    [
      { id: 'done', title: 'Done' },
      { id: 'skip', title: 'Skip' },
      { id: 'watch_video', title: 'Watch Video' },
    ],
    header
  );

  await pool.query(
    `insert into session_logs (daily_plan_id, exercise_id, sent_at) values ($1, $2, now())`,
    [plan.id, exerciseId]
  );

  if (plan.status !== 'in_progress') {
    await pool.query(`update daily_plans set status = 'in_progress' where id = $1`, [plan.id]);
  }
}

async function currentSessionLog(planId) {
  const { rows } = await pool.query(
    `select * from session_logs where daily_plan_id = $1
     and completed_at is null and skipped = false
     order by sent_at desc limit 1`,
    [planId]
  );
  return rows[0] || null;
}

async function computeStreak(recipient) {
  const { rows } = await pool.query(
    `select date from daily_plans
     where care_recipient_id = $1 and status = 'completed'`,
    [recipient.id]
  );

  const completedDates = new Set(rows.map((row) => row.date));
  let streak = 0;
  let expected = localDateString(recipient.timezone);
  while (completedDates.has(expected)) {
    streak += 1;
    expected = addDaysToDateString(expected, -1);
  }
  return streak;
}

async function sendClosingMessage(recipient, plan) {
  const { rows } = await pool.query(
    'select completed_at, skipped from session_logs where daily_plan_id = $1',
    [plan.id]
  );
  const total = plan.exercise_ids.length;
  const completed = rows.filter((r) => r.completed_at).length;

  await pool.query(`update daily_plans set status = 'completed' where id = $1`, [plan.id]);
  const streak = await computeStreak(recipient);

  const streakLine = streak > 1 ? ` ${streak}-day streak!` : '';
  const body = `Great job! You completed ${completed}/${total} exercises today.${streakLine}`;
  await sendAndLog(recipient, body);
}

async function advancePlan(recipient, plan) {
  const nextIndex = await sentExerciseCount(plan.id);
  if (nextIndex < plan.exercise_ids.length) {
    await sendExerciseAtIndex(recipient, plan, nextIndex);
  } else {
    await sendClosingMessage(recipient, plan);
  }
}

async function handleWatchVideo(recipient, plan) {
  const currentLog = await currentSessionLog(plan.id);
  const exercise = currentLog ? await getExercise(currentLog.exercise_id) : null;

  if (exercise?.video_media_id) {
    await sendVideo(recipient.phone_number, exercise.video_media_id, exercise.name);
    await logMessage({
      careRecipientId: recipient.id,
      direction: 'out',
      body: `[video] ${exercise.name}`,
      whatsappMessageId: null,
    });
  } else {
    await sendAndLog(recipient, "No video for this one yet - but you've got the instructions above. Reply DONE or SKIP whenever you're ready.");
  }
  // Watching doesn't advance the plan - they still need to reply DONE/SKIP after.
}

async function handleInboundReply(recipient, inbound) {
  const plan = await getTodayPlan(recipient);
  if (!plan) {
    await sendAndLog(recipient, "Nothing scheduled right now - we'll message you at your usual time.");
    return;
  }

  const intent = inbound.source === 'button'
    ? intentFromButtonId(inbound.buttonId)
    : classifyIntent(inbound.rawText);

  if (plan.status === 'sent') {
    if (intent === 'YES') {
      await advancePlan(recipient, plan);
    } else if (intent === 'NOT_NOW') {
      // Leave status as 'sent' - the existing follow-up nudge still fires later.
      await sendAndLog(recipient, 'No problem! We\'ll be here whenever you\'re ready today.');
    } else {
      await sendAndLog(recipient, 'Whenever you\'re ready, just tap "Yes, let\'s go" to start today\'s exercises.');
    }
    return;
  }

  if (plan.status === 'in_progress') {
    const currentLog = await currentSessionLog(plan.id);

    if (intent === 'DONE') {
      if (currentLog) {
        await pool.query('update session_logs set completed_at = now() where id = $1', [currentLog.id]);
      }
      await advancePlan(recipient, plan);
    } else if (intent === 'SKIP') {
      if (currentLog) {
        await pool.query('update session_logs set skipped = true where id = $1', [currentLog.id]);
      }
      await advancePlan(recipient, plan);
    } else if (intent === 'WATCH_VIDEO') {
      await handleWatchVideo(recipient, plan);
    } else {
      await sendAndLog(recipient, 'Tap Done when you finish, or Skip to move on.');
    }
    return;
  }

  // status is completed / no_response / skipped - nothing left to do today
  await sendAndLog(recipient, "You're all done for today - see you tomorrow!");
}

async function triggerDailyForRecipient(recipient) {
  const existingPlan = await getTodayPlan(recipient);

  // A plan can exist but still be 'pending' if it was created but the send
  // itself failed (e.g. an expired WhatsApp token) - retry the send rather
  // than treating it as already handled and leaving it stuck forever.
  if (existingPlan && existingPlan.status !== 'pending') {
    return { recipient: recipient.name, action: 'already_planned' };
  }

  const nowLocal = localTimeString(recipient.timezone);
  const preferredTime = recipient.preferred_time.slice(0, 5);
  if (nowLocal < preferredTime) return { recipient: recipient.name, action: 'not_yet_time' };

  const plan = existingPlan || (await createTodayPlan(recipient));
  await sendInitialPrompt(recipient, plan);
  return { recipient: recipient.name, action: 'sent' };
}

async function checkFollowupsForRecipient(recipient) {
  const plan = await getTodayPlan(recipient);
  if (!plan || plan.status !== 'sent') return { recipient: recipient.name, action: 'none' };

  const nowLocal = localTimeString(recipient.timezone);
  const sentAt = new Date(plan.prompt_sent_at);
  const hoursSincePrompt = Date.now() - sentAt.getTime();

  if (!plan.followup_sent_at && hoursSincePrompt >= FOLLOWUP_AFTER_MS) {
    // Re-send as buttons (not plain text) - consistent with the rest of the
    // flow, and avoids stale copy telling them to type a word for a button.
    await sendButtonsAndLog(recipient, 'No rush - still want to do today\'s exercises?', [
      { id: 'yes', title: "Yes, let's go" },
      { id: 'not_now', title: 'Not now' },
    ]);
    await pool.query('update daily_plans set followup_sent_at = now() where id = $1', [plan.id]);
    return { recipient: recipient.name, action: 'followup_sent' };
  }

  if (nowLocal >= CUTOFF_TIME) {
    await pool.query(`update daily_plans set status = 'no_response' where id = $1`, [plan.id]);
    return { recipient: recipient.name, action: 'marked_no_response' };
  }

  return { recipient: recipient.name, action: 'waiting' };
}

module.exports = {
  handleInboundReply,
  triggerDailyForRecipient,
  checkFollowupsForRecipient,
};
