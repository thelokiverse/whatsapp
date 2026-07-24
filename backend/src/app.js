const express = require('express');
const cors = require('cors');
const healthRouter = require('./routes/health');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);

  return app;
}

module.exports = { createApp };
