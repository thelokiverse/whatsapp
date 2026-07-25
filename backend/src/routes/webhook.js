const express = require('express');
const crypto = require('crypto');
const { findRecipientByPhone, logMessage } = require('../services/messageLog');
const { handleInboundReply } = require('../services/conversationEngine');

const router = express.Router();

// Confirms a webhook call actually came from Meta, not an arbitrary POST to
// our public URL - without this, anyone who finds the endpoint could inject
// fake inbound messages/replies. Skips the check if WHATSAPP_APP_SECRET
// isn't set (e.g. local dev without a configured app secret) rather than
// blocking everything.
function verifyWebhookSignature(req, res, next) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return next();

  const signatureHeader = req.headers['x-hub-signature-256'];
  if (!signatureHeader) return res.sendStatus(401);

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

  const signatureBuf = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    return res.sendStatus(401);
  }
  next();
}

// Meta calls this once, at setup time, to verify we control this endpoint.
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta calls this for every inbound message/status update.
router.post('/webhook', verifyWebhookSignature, async (req, res) => {
  // Ack immediately - Meta expects a fast 200 and will retry/disable the
  // webhook if we're slow, regardless of how long our own processing takes.
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (value?.statuses) {
      for (const status of value.statuses) {
        console.log(
          `Delivery status: message ${status.id} to ${status.recipient_id} -> ${status.status}` +
            (status.errors ? ` errors=${JSON.stringify(status.errors)}` : '')
        );
      }
    }

    const messages = value?.messages;
    if (!messages || messages.length === 0) return; // e.g. delivery/read status updates only

    for (const message of messages) {
      const from = `+${message.from}`;
      const recipient = await findRecipientByPhone(from);

      if (!recipient) {
        // Fixed allowlist only - by design we do not process messages from
        // numbers we don't already know about.
        console.log(`Ignoring inbound message from unknown number: ${from}`);
        continue;
      }

      let inbound;
      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        const buttonId = message.interactive.button_reply.id;
        inbound = { source: 'button', buttonId, rawText: message.interactive.button_reply.title };
      } else {
        const rawText = message.text?.body ?? `[unsupported message type: ${message.type}]`;
        inbound = { source: 'text', rawText };
      }

      await logMessage({
        careRecipientId: recipient.id,
        direction: 'in',
        body: inbound.rawText,
        whatsappMessageId: message.id,
      });
      console.log(`Logged inbound message from ${recipient.name}: "${inbound.rawText}"`);

      await handleInboundReply(recipient, inbound);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

module.exports = router;
