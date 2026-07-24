require('dotenv').config();
const { pool } = require('../src/config/db');
const { handleInboundReply, checkFollowupsForRecipient } = require('../src/services/conversationEngine');

const [, , phone] = process.argv;
if (!phone) {
  console.error('Usage: node scripts/test-edge-cases.js <phone_e164>');
  console.error('Runs against an existing care_recipient + today\'s daily_plan - use a test recipient, not a real one.');
  process.exit(1);
}

async function run() {
  const { rows: recipients } = await pool.query('select * from care_recipients where phone_number = $1', [phone]);
  const recipient = recipients[0];
  if (!recipient) {
    console.error(`No care_recipient found for ${phone}`);
    process.exit(1);
  }
  const { rows: plans } = await pool.query('select * from daily_plans where care_recipient_id = $1', [recipient.id]);
  const plan = plans[0];
  if (!plan) {
    console.error('No daily_plan found for this recipient yet - run /trigger-daily first.');
    process.exit(1);
  }

  console.log('--- Test A: unrecognized reply while status=sent ---');
  await pool.query("update daily_plans set status = 'sent', prompt_sent_at = now() where id = $1", [plan.id]);
  await handleInboundReply(recipient, 'banana');
  console.log('Sent clarifying nudge (check WhatsApp).');

  console.log('--- Test B: 2hr follow-up nudge ---');
  await pool.query(
    "update daily_plans set status = 'sent', prompt_sent_at = now() - interval '3 hours', followup_sent_at = null where id = $1",
    [plan.id]
  );
  const resultB = await checkFollowupsForRecipient(recipient);
  console.log('Result:', resultB, '(expect action: followup_sent, check WhatsApp)');

  console.log('--- Test C: past cutoff -> no_response, no extra message ---');
  await pool.query("update care_recipients set timezone = 'Etc/GMT-5' where id = $1", [recipient.id]);
  const { rowCount: beforeCount } = await pool.query('select 1 from message_log');
  const recipientDubai = { ...recipient, timezone: 'Etc/GMT-5' };
  const resultC = await checkFollowupsForRecipient(recipientDubai);
  const { rowCount: afterCount } = await pool.query('select 1 from message_log');
  console.log('Result:', resultC, '(expect action: marked_no_response)');
  console.log('message_log row count before/after (should be equal - no extra send):', beforeCount, afterCount);

  await pool.query("update care_recipients set timezone = 'UTC' where id = $1", [recipient.id]);
  await pool.end();
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
