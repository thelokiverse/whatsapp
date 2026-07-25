const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { localDateString, addDaysToDateString } = require('../utils/time');

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

function buildCalendar(days, planRows, todayStr) {
  const byDate = new Map(planRows.map((row) => [row.date, row.status]));
  const calendar = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dateStr = addDaysToDateString(todayStr, -i);
    calendar.push({ date: dateStr, status: byDate.get(dateStr) || 'none' });
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
       order by skip_count desc
       limit 5`,
      [id]
    );
    const { rows: exerciseRows } = await pool.query('select id, data from exercise_library');
    const exerciseNameById = new Map(exerciseRows.map((row) => [row.id, row.data.name]));

    const completedCount = planRows.filter((r) => r.status === 'completed').length;

    res.json({
      recipient: { id: recipient.id, name: recipient.name },
      days,
      adherencePct: Math.round((completedCount / days) * 100),
      currentStreak: computeStreakFromPlans(allPlanRows, todayStr),
      calendar: buildCalendar(days, planRows, todayStr),
      mostSkipped: skippedRows.map((row) => ({
        exerciseId: row.exercise_id,
        name: exerciseNameById.get(row.exercise_id) || row.exercise_id,
        skipCount: row.skip_count,
      })),
    });
  })
);

module.exports = router;
