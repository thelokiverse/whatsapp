const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { localDateString, dateStringInTimezone, addDaysToDateString } = require('../utils/time');

const router = express.Router();
router.use('/api', requireAuth);

router.get(
  '/api/recipients',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'select id, name, mobility_level, timezone from care_recipients order by name'
    );
    res.json(rows);
  })
);

// dayOfWeek lets the frontend align cells to actual weekday columns (0=Sun).
// recipientCreatedDateStr distinguishes two different-looking "empty" cases
// per the brief: a day before this recipient even existed ('before_start')
// vs. a day within their active history where no plan was created
// ('none') - both used to render as the same gray box.
function buildCalendar(days, planRows, todayStr, recipientCreatedDateStr) {
  const byDate = new Map(planRows.map((row) => [row.date, row.status]));
  const calendar = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dateStr = addDaysToDateString(todayStr, -i);
    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
    const beforeStart = recipientCreatedDateStr && dateStr < recipientCreatedDateStr;
    const status = byDate.get(dateStr) || (beforeStart ? 'before_start' : 'none');
    calendar.push({ date: dateStr, status, dayOfWeek });
  }
  return calendar;
}

function computeStreakFromPlans(planRows, todayStr) {
  const completedDates = new Set(planRows.filter((r) => r.status === 'completed').map((r) => r.date));
  let streak = 0;
  let cursor = todayStr;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateString(cursor, -1);
  }
  return streak;
}

// "Does this person need me to step in?" signals - the one thing the old
// dashboard didn't have at all. Computed from the same allPlanRows already
// fetched for the streak, so no extra query.
function computeAlerts(allPlanRows, todayStr, failedMessageCount) {
  const alerts = [];

  if (failedMessageCount > 0) {
    alerts.push({
      type: 'send_failed',
      count: failedMessageCount,
      message: `${failedMessageCount} message${failedMessageCount > 1 ? 's' : ''} failed to send recently - this may look like they're not responding when they never actually got a message`,
    });
  }

  let noResponseStreak = 0;
  let cursor = todayStr;
  while (true) {
    const row = allPlanRows.find((r) => r.date === cursor);
    if (!row || row.status !== 'no_response') break;
    noResponseStreak += 1;
    cursor = addDaysToDateString(cursor, -1);
  }
  if (noResponseStreak >= 2) {
    alerts.push({ type: 'no_response', days: noResponseStreak, message: `No response in ${noResponseStreak} days` });
  }

  const last7 = allPlanRows.filter((r) => r.date >= addDaysToDateString(todayStr, -6));
  const skipsThisWeek = last7.filter((r) => r.status === 'skipped').length;
  if (skipsThisWeek >= 3) {
    alerts.push({
      type: 'high_skips',
      count: skipsThisWeek,
      message: `${skipsThisWeek} exercises skipped this week - worth checking in?`,
    });
  }

  return alerts;
}

function computeAdherenceTrend(allPlanRows, todayStr) {
  const pct = (fromDaysAgo, toDaysAgo) => {
    const start = addDaysToDateString(todayStr, -fromDaysAgo);
    const end = addDaysToDateString(todayStr, -toDaysAgo);
    const windowRows = allPlanRows.filter((r) => r.date >= start && r.date <= end);
    const completed = windowRows.filter((r) => r.status === 'completed').length;
    return Math.round((completed / 7) * 100);
  };

  const thisWeek = pct(6, 0);
  const lastWeek = pct(13, 7);
  const direction = thisWeek > lastWeek ? 'up' : thisWeek < lastWeek ? 'down' : 'flat';
  return { thisWeek, lastWeek, direction };
}

// Average minutes between the initial prompt and the recipient actually
// starting (their first exercise send) - a leading indicator of disengagement
// that shows up before adherence % actually drops.
async function computeResponseTiming(recipientId, todayStr) {
  const { rows } = await pool.query(
    `select dp.prompt_sent_at, min(sl.sent_at) as first_exercise_sent_at
     from daily_plans dp
     join session_logs sl on sl.daily_plan_id = dp.id
     where dp.care_recipient_id = $1 and dp.prompt_sent_at is not null
       and dp.date >= $2
     group by dp.id, dp.prompt_sent_at`,
    [recipientId, addDaysToDateString(todayStr, -6)]
  );

  if (rows.length === 0) return { avgMinutes: null, pattern: 'no_data' };

  const minutes = rows.map(
    (r) => (new Date(r.first_exercise_sent_at) - new Date(r.prompt_sent_at)) / 60000
  );
  const avgMinutes = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
  const pattern = avgMinutes < 30 ? 'on_time' : avgMinutes < 120 ? 'delayed' : 'prompt_needed';
  return { avgMinutes, pattern };
}

router.get(
  '/api/recipients/:id/stats',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;

    const { rows: recipientRows } = await pool.query('select * from care_recipients where id = $1', [id]);
    const recipient = recipientRows[0];
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const todayStr = localDateString(recipient.timezone);
    const rangeStartStr = addDaysToDateString(todayStr, -(days - 1));

    const { rows: planRows } = await pool.query(
      `select date, status from daily_plans
       where care_recipient_id = $1 and date >= $2
       order by date`,
      [id, rangeStartStr]
    );

    const { rows: allPlanRows } = await pool.query(
      `select date, status from daily_plans where care_recipient_id = $1 order by date desc`,
      [id]
    );

    const { rows: skippedRows } = await pool.query(
      `select sl.exercise_id, count(*)::int as skip_count
       from session_logs sl
       join daily_plans dp on dp.id = sl.daily_plan_id
       where dp.care_recipient_id = $1 and sl.skipped = true
       group by sl.exercise_id
       having count(*) >= 2
       order by skip_count desc
       limit 5`,
      [id]
    );
    // exercise_id can be either a v1 exercise_library text id or a v2
    // exercise_catalog UUID (see conversationEngine.getExercise) - check both.
    const { rows: legacyRows } = await pool.query('select id, data from exercise_library');
    const { rows: catalogRows } = await pool.query('select id, name from exercise_catalog');
    const exerciseNameById = new Map([
      ...legacyRows.map((row) => [row.id, row.data.name]),
      ...catalogRows.map((row) => [row.id, row.name]),
    ]);

    const { rows: failedRows } = await pool.query(
      `select count(*)::int as count from message_log
       where care_recipient_id = $1 and send_failed = true and created_at > now() - interval '3 days'`,
      [id]
    );

    const completedCount = planRows.filter((r) => r.status === 'completed').length;
    const createdDateStr = dateStringInTimezone(recipient.created_at, recipient.timezone);

    res.json({
      recipient: { id: recipient.id, name: recipient.name },
      days,
      adherencePct: Math.round((completedCount / days) * 100),
      currentStreak: computeStreakFromPlans(allPlanRows, todayStr),
      calendar: buildCalendar(days, planRows, todayStr, createdDateStr),
      alerts: computeAlerts(allPlanRows, todayStr, failedRows[0].count),
      adherenceTrend: computeAdherenceTrend(allPlanRows, todayStr),
      responseTiming: await computeResponseTiming(id, todayStr),
      mostSkipped: skippedRows.map((row) => ({
        exerciseId: row.exercise_id,
        name: exerciseNameById.get(row.exercise_id) || row.exercise_id,
        skipCount: row.skip_count,
        framing: `This exercise has been skipped ${row.skip_count} times - it may be uncomfortable for them`,
      })),
    });
  })
);

router.get(
  '/api/recipients/:id/failed-messages',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `select body, created_at from message_log
       where care_recipient_id = $1 and send_failed = true
       order by created_at desc limit 20`,
      [req.params.id]
    );
    res.json(rows);
  })
);

module.exports = router;
