const express = require('express');
const { pool } = require('../config/db');
const { triggerDailyForRecipient, checkFollowupsForRecipient } = require('../services/conversationEngine');

const router = express.Router();

function requireTriggerSecret(req, res, next) {
  const provided = req.headers['x-trigger-secret'];
  if (!process.env.TRIGGER_SECRET || provided !== process.env.TRIGGER_SECRET) {
    return res.sendStatus(401);
  }
  return next();
}

router.use(['/trigger-daily', '/check-followups'], requireTriggerSecret);

async function getAllRecipients() {
  const { rows } = await pool.query('select * from care_recipients');
  return rows;
}

// Called by an external cron periodically (e.g. every 15-30 min). For each
// recipient, sends the initial daily prompt once their preferred_time has
// passed, if today's plan hasn't already been sent.
router.post('/trigger-daily', async (req, res) => {
  try {
    const recipients = await getAllRecipients();
    const results = [];
    for (const recipient of recipients) {
      results.push(await triggerDailyForRecipient(recipient));
    }
    res.json({ results });
  } catch (err) {
    console.error('trigger-daily failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Called by an external cron periodically. Sends the one gentle 2-hour
// follow-up nudge, and marks no_response past the evening cutoff.
router.post('/check-followups', async (req, res) => {
  try {
    const recipients = await getAllRecipients();
    const results = [];
    for (const recipient of recipients) {
      results.push(await checkFollowupsForRecipient(recipient));
    }
    res.json({ results });
  } catch (err) {
    console.error('check-followups failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
