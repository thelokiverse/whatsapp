// YYYY-MM-DD for "today" in the recipient's own timezone (not the server's).
function localDateString(timezone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
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

module.exports = { localDateString, localTimeString };
