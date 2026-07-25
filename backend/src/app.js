const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');
const webhookRouter = require('./routes/webhook');
const triggerRouter = require('./routes/trigger');
const authRouter = require('./routes/auth');
const dashboardApiRouter = require('./routes/dashboardApi');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);
  app.use(webhookRouter);
  app.use(triggerRouter);
  app.use(authRouter);
  app.use(dashboardApiRouter);

  return app;
}

module.exports = { createApp };
