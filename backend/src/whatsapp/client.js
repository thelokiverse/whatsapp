const GRAPH_API_VERSION = 'v20.0';

function apiUrl() {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

async function postOnce(payload) {
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// Retries once on a transient failure (429 rate limit, 5xx) after a short
// delay - a genuinely bad request (invalid number, bad token) fails the same
// way twice, so this only helps the transient case, not a design to paper
// over real errors.
async function postMessage(payload) {
  let result = await postOnce(payload);

  if (!result.ok && (result.status === 429 || result.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await postOnce(payload);
  }

  if (!result.ok) {
    throw new Error(`WhatsApp send failed: ${JSON.stringify(result.data)}`);
  }
  return result.data.messages?.[0]?.id || null;
}

async function sendText(to, body) {
  return postMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  });
}

// buttons: [{ id, title }], max 3, title under 20 chars (WhatsApp's own limit).
// header: optional { type: 'video', mediaId } - omit entirely for text-only messages
// (confirmed via live test: the button message works fine with no header at all).
async function sendInteractiveButtons(to, body, buttons, header) {
  const interactive = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  };

  if (header) {
    interactive.header = {
      type: header.type,
      [header.type]: { id: header.mediaId },
    };
  }

  return postMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive,
  });
}

// videoMediaId: an ID already uploaded via the WhatsApp Media API (not a raw URL -
// WhatsApp's Media API only accepts video/mp4 and video/3gpp, never image/gif, so
// any GIF source must be converted and uploaded first - see whatsapp/mediaCache.js).
async function sendVideo(to, videoMediaId, caption) {
  return postMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'video',
    video: { id: videoMediaId, caption },
  });
}

module.exports = { sendText, sendInteractiveButtons, sendVideo };
