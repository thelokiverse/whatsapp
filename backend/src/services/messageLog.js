const { pool } = require('../config/db');

async function findRecipientByPhone(phoneNumber) {
  const { rows } = await pool.query(
    'select * from care_recipients where phone_number = $1',
    [phoneNumber]
  );
  return rows[0] || null;
}

async function logMessage({ careRecipientId, direction, body, whatsappMessageId }) {
  await pool.query(
    `insert into message_log (care_recipient_id, direction, body, whatsapp_message_id)
     values ($1, $2, $3, $4)`,
    [careRecipientId, direction, body, whatsappMessageId || null]
  );
}

module.exports = { findRecipientByPhone, logMessage };
