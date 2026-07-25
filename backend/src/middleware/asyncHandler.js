// Express 4 does not catch rejected promises from async route handlers -
// an unhandled rejection can crash the whole Node process (and take down
// the WhatsApp bot along with whatever dashboard request triggered it).
// Wrap async handlers with this so errors reach the error middleware instead.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
