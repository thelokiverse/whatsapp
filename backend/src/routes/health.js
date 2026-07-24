const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query('select 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

module.exports = router;
