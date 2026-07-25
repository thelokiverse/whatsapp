// Resolves a WorkoutX GIF URL to a WhatsApp media ID, caching the result so the
// same exercise doesn't get re-downloaded/re-converted/re-uploaded on every send.
//
// WhatsApp's Media API only accepts image/jpeg, image/png, image/webp, video/mp4,
// and video/3gpp - it rejects image/gif outright (confirmed by testing, not just
// docs - see README gotcha). So every GIF is converted to a small mp4 with
// ffmpeg-static before upload. WhatsApp media IDs are valid for ~30 days, hence
// the expires_at tracking here.

const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const { pool } = require('../config/db');

const GRAPH_API_VERSION = 'v20.0';
const MEDIA_TTL_DAYS = 25; // conservative - real WhatsApp expiry is ~30 days

function mediaApiUrl() {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`;
}

async function getCachedMediaId(sourceUrl) {
  const { rows } = await pool.query(
    `select whatsapp_media_id from media_cache
     where source_url = $1 and (expires_at is null or expires_at > now())`,
    [sourceUrl]
  );
  return rows[0]?.whatsapp_media_id || null;
}

async function downloadGif(gifUrl) {
  const apiKey = process.env.WORKOUTX_API_KEY;
  const res = await fetch(gifUrl, { headers: { 'X-WorkoutX-Key': apiKey } });
  if (!res.ok) {
    throw new Error(`Failed to download GIF from WorkoutX: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function convertGifToMp4(gifBuffer) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const gifPath = path.join(tmpDir, `${id}.gif`);
  const mp4Path = path.join(tmpDir, `${id}.mp4`);

  await fs.writeFile(gifPath, gifBuffer);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i', gifPath,
      '-movflags', 'faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      mp4Path,
    ]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });

  const mp4Buffer = await fs.readFile(mp4Path);
  await Promise.all([fs.unlink(gifPath).catch(() => {}), fs.unlink(mp4Path).catch(() => {})]);
  return mp4Buffer;
}

async function uploadToWhatsApp(mp4Buffer) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'video/mp4');
  form.append('file', new Blob([mp4Buffer], { type: 'video/mp4' }), 'exercise.mp4');

  const res = await fetch(mediaApiUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`WhatsApp media upload failed: ${JSON.stringify(data)}`);
  }
  return data.id;
}

// Downloads the GIF, converts to mp4, uploads to WhatsApp, and caches the
// resulting media ID against the source URL. Throws on any failure - callers
// should catch and fall back to text-only (never block plan generation on
// media resolution).
async function uploadAndCache(sourceUrl) {
  const gifBuffer = await downloadGif(sourceUrl);
  const mp4Buffer = await convertGifToMp4(gifBuffer);
  const mediaId = await uploadToWhatsApp(mp4Buffer);

  await pool.query(
    `insert into media_cache (source_url, whatsapp_media_id, expires_at)
     values ($1, $2, now() + interval '${MEDIA_TTL_DAYS} days')
     on conflict (source_url) do update set
       whatsapp_media_id = excluded.whatsapp_media_id,
       expires_at = excluded.expires_at`,
    [sourceUrl, mediaId]
  );

  return mediaId;
}

async function getOrUploadMediaId(sourceUrl) {
  const cached = await getCachedMediaId(sourceUrl);
  if (cached) return cached;
  return uploadAndCache(sourceUrl);
}

module.exports = { getCachedMediaId, uploadAndCache, getOrUploadMediaId };
