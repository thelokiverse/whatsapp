require('dotenv').config();
const { sendText } = require('../src/whatsapp/client');

const [, , to, ...bodyParts] = process.argv;
const body = bodyParts.join(' ') || 'Hello! This is a test message from WhatsApp Flow.';

if (!to) {
  console.error('Usage: node scripts/send-test-message.js <phone_e164> "<message>"');
  process.exit(1);
}

sendText(to, body)
  .then((messageId) => {
    console.log(`Sent. WhatsApp message id: ${messageId}`);
  })
  .catch((err) => {
    console.error('Send failed:', err.message);
    process.exit(1);
  });
