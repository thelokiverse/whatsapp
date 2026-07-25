// YYYY-MM-DD for "today" in the recipient's own timezone (not the server's).
function localDateString(timezone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
}

// Same conversion as localDateString, but for an arbitrary instant (e.g. a
// plan_rotations.generated_at timestamptz) instead of "now" - kept separate
// from localDateString rather than adding an optional param, so every
// existing "today" call site is untouched.
function dateStringInTimezone(date, timezone) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: timezone });
}

// Current local time as "HH:MM" in the recipient's own timezone.
function localTimeString(timezone) {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Pure "YYYY-MM-DD" string arithmetic, anchored at UTC noon so a +/-1 day
// shift can never cross into the adjacent date due to a timezone offset.
// Use this instead of `new Date(dateStr)` + setDate() for calendar-day math.
function addDaysToDateString(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

module.exports = { localDateString, dateStringInTimezone, localTimeString, addDaysToDateString };
