const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

router.get('/health', async (req, res) => {
  const commit = process.env.RENDER_GIT_COMMIT || 'local';
  try {
    await pool.query('select 1');
    res.json({ status: 'ok', db: 'connected', commit });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message, commit });
  }
});

module.exports = router;
