// Confirms buildCalendar()'s date-to-index mapping with known input dates,
// per the v2 brief's instruction to verify the actual root cause before
// "fixing" a reported calendar bug rather than guessing.
//
// Result: the mapping itself is correct - oldest date at index 0 (left),
// today at index [days-1] (right), each status matched to its own date.
// This was most likely already fixed by the Phase 5 timezone rewrite
// (pg.types.setTypeParser + addDaysToDateString), which happened after the
// usability review that produced the v2 brief. The genuine remaining gap is
// that the grid has no weekday alignment (Phase 8a addresses that instead).

const assert = require('assert');
const { addDaysToDateString } = require('../src/utils/time');

// Mirrors dashboardApi.js's buildCalendar() exactly.
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

function run() {
  const todayStr = '2026-07-25';
  const planRows = [
    { date: '2026-07-25', status: 'completed' },
    { date: '2026-07-24', status: 'skipped' },
    { date: '2026-07-19', status: 'no_response' },
  ];

  const calendar = buildCalendar(7, planRows, todayStr);

  assert.strictEqual(calendar.length, 7, 'expected 7 entries for a 7-day window');
  assert.strictEqual(calendar[0].date, '2026-07-19', 'oldest date must be first (index 0)');
  assert.strictEqual(calendar[0].status, 'no_response');
  assert.strictEqual(calendar[6].date, todayStr, 'today must be last (index days-1)');
  assert.strictEqual(calendar[6].status, 'completed');
  assert.strictEqual(calendar[5].date, '2026-07-24');
  assert.strictEqual(calendar[5].status, 'skipped');
  // Days with no daily_plans row must show as 'none', not be skipped/misaligned.
  assert.strictEqual(calendar[1].date, '2026-07-20');
  assert.strictEqual(calendar[1].status, 'none');

  // Month-boundary case: today near the start of a month, window spans back
  // into the previous month.
  const boundaryCalendar = buildCalendar(7, [{ date: '2026-08-01', status: 'completed' }], '2026-08-01');
  assert.strictEqual(boundaryCalendar[0].date, '2026-07-26');
  assert.strictEqual(boundaryCalendar[6].date, '2026-08-01');
  assert.strictEqual(boundaryCalendar[6].status, 'completed');

  // dayOfWeek: 2026-07-25 is a Saturday (day 6).
  assert.strictEqual(calendar[6].dayOfWeek, 6);

  // before_start: a recipient created 2026-07-23 should show 'before_start'
  // for any earlier day with no plan row, distinct from a real gap ('none')
  // within their active history. (A planRows entry predating the recipient's
  // creation can't actually happen - daily_plans has a FK to care_recipients -
  // so this only tests dates with no data either way.)
  const withStart = buildCalendar(7, [], todayStr, '2026-07-23');
  assert.strictEqual(withStart[1].date, '2026-07-20');
  assert.strictEqual(withStart[1].status, 'before_start', '2026-07-20 is before the recipient existed');
  assert.strictEqual(withStart[4].date, '2026-07-23');
  assert.strictEqual(withStart[4].status, 'none', '2026-07-23 onward with no plan row is a real gap, not before_start');

  console.log('All calendar mapping checks passed.');
}

run();
