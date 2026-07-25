const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const healthRouter = require('./routes/health');
const webhookRouter = require('./routes/webhook');
const triggerRouter = require('./routes/trigger');
const authRouter = require('./routes/auth');
const dashboardApiRouter = require('./routes/dashboardApi');
const onboardingApiRouter = require('./routes/onboardingApi');
const mediaProxyRouter = require('./routes/mediaProxy');

const DASHBOARD_DIST = path.join(__dirname, '../../dashboard/dist');

function createApp() {
  const app = express();
  app.use(cors());
  // Preserves the raw request body alongside the parsed JSON - the webhook's
  // HMAC signature check needs the exact bytes Meta signed, not a
  // re-serialized copy (which can differ in key order/whitespace).
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.use(healthRouter);
  app.use(webhookRouter);
  app.use(triggerRouter);
  app.use(authRouter);
  app.use(dashboardApiRouter);
  app.use(onboardingApiRouter);
  app.use(mediaProxyRouter);

  // Serve the built caregiver dashboard (React SPA) from the same service.
  // Falls back silently if dist/ hasn't been built (e.g. local API-only dev).
  if (fs.existsSync(DASHBOARD_DIST)) {
    app.use(express.static(DASHBOARD_DIST));
    app.get('*', (req, res) => res.sendFile(path.join(DASHBOARD_DIST, 'index.html')));
  }

  // Catches errors forwarded by asyncHandler (and anything passed to next())
  // so a single bad request returns a 500 instead of crashing the process -
  // this same process also runs the WhatsApp bot for real users.
  app.use((err, req, res, next) => {
    console.error('Unhandled request error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
