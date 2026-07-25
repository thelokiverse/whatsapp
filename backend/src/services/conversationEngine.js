const { pool } = require('../config/db');
const { sendText } = require('../whatsapp/client');
const { logMessage } = require('./messageLog');
const { classifyIntent } = require('./intent');
const { selectExercisesForToday } = require('./planSelection');
const { localDateString, localTimeString, addDaysToDateString } = require('../utils/time');

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

async function getExercise(exerciseId) {
  const { rows } = await pool.query('select data from exercise_library where id = $1', [exerciseId]);
  return rows[0]?.data || null;
}

async function getTodayPlan(recipient) {
  const date = localDateString(recipient.timezone);
  const { rows } = await pool.query(
    'select * from daily_plans where care_recipient_id = $1 and date = $2',
    [recipient.id, date]
  );
  return rows[0] || null;
}

async function createTodayPlan(recipient) {
  const date = localDateString(recipient.timezone);
  const exerciseIds = await selectExercisesForToday(recipient);
  const { rows } = await pool.query(
    `insert into daily_plans (care_recipient_id, date, exercise_ids, status)
     values ($1, $2, $3, 'pending')
     returning *`,
    [recipient.id, date, JSON.stringify(exerciseIds)]
  );
  return rows[0];
}

async function sendInitialPrompt(recipient, plan) {
  const body = `Hi ${recipient.name}! Time for your evening exercises. Ready to start? Reply YES to begin.`;
  await sendAndLog(recipient, body);
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

  const body = `${exercise.name}\n${exercise.instruction_simple}\n${exercise.duration_or_reps}.\nReply DONE when finished, or SKIP to move on.`;
  await sendAndLog(recipient, body);

  await pool.query(
    `insert into session_logs (daily_plan_id, exercise_id, sent_at) values ($1, $2, now())`,
    [plan.id, exerciseId]
  );

  if (plan.status !== 'in_progress') {
    await pool.query(`update daily_plans set status = 'in_progress' where id = $1`, [plan.id]);
  }
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

async function handleInboundReply(recipient, text) {
  const plan = await getTodayPlan(recipient);
  if (!plan) {
    await sendAndLog(recipient, "There's nothing scheduled right now. We'll message you at your usual time.");
    return;
  }

  const intent = classifyIntent(text);

  if (plan.status === 'sent') {
    if (intent === 'YES') {
      await advancePlan(recipient, plan);
    } else {
      await sendAndLog(recipient, 'Reply YES when you are ready to start today\'s exercises.');
    }
    return;
  }

  if (plan.status === 'in_progress') {
    const { rows } = await pool.query(
      `select * from session_logs where daily_plan_id = $1
       and completed_at is null and skipped = false
       order by sent_at desc limit 1`,
      [plan.id]
    );
    const currentLog = rows[0];

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
    } else {
      await sendAndLog(recipient, 'Sorry, I did not understand. Reply DONE when you finish, or SKIP to move on.');
    }
    return;
  }

  // status is completed / no_response / skipped - nothing left to do today
  await sendAndLog(recipient, "You're all done for today. See you tomorrow!");
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
    await sendAndLog(
      recipient,
      'No rush - still want to do today\'s exercises? Reply YES anytime before bed.'
    );
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
