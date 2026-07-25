const { pool } = require('../config/db');

async function findRecipientByPhone(phoneNumber) {
  const { rows } = await pool.query(
    'select * from care_recipients where phone_number = $1',
    [phoneNumber]
  );
  return rows[0] || null;
}

async function logMessage({ careRecipientId, direction, body, whatsappMessageId, sendFailed }) {
  await pool.query(
    `insert into message_log (care_recipient_id, direction, body, whatsapp_message_id, send_failed, retry_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      careRecipientId,
      direction,
      body,
      whatsappMessageId || null,
      !!sendFailed,
      sendFailed ? new Date(Date.now() + 5 * 60 * 1000) : null,
    ]
  );
}

module.exports = { findRecipientByPhone, logMessage };
