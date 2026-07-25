const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const healthRouter = require('./routes/health');
const webhookRouter = require('./routes/webhook');
const triggerRouter = require('./routes/trigger');
const authRouter = require('./routes/auth');
const dashboardApiRouter = require('./routes/dashboardApi');

const DASHBOARD_DIST = path.join(__dirname, '../../dashboard/dist');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);
  app.use(webhookRouter);
  app.use(triggerRouter);
  app.use(authRouter);
  app.use(dashboardApiRouter);

  // Serve the built caregiver dashboard (React SPA) from the same service.
  // Falls back silently if dist/ hasn't been built (e.g. local API-only dev).
  if (fs.existsSync(DASHBOARD_DIST)) {
    app.use(express.static(DASHBOARD_DIST));
    app.get('*', (req, res) => res.sendFile(path.join(DASHBOARD_DIST, 'index.html')));
  }

  return app;
}

module.exports = { createApp };
