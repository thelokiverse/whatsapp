const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');
const webhookRouter = require('./routes/webhook');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);
  app.use(webhookRouter);

  return app;
}

module.exports = { createApp };
