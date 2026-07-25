const express = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

// Streams an exercise's demo GIF through our server so the dashboard can use
// a plain <img src>. WorkoutX's gifUrl requires our API key to fetch (see
// README gotcha), and this app's auth is a Bearer token in JS fetch calls,
// not a cookie - an <img> tag can't attach that header, so downloading via
// JS as a blob is the alternative, and this proxy is the simpler one.
// Deliberately left unauthenticated: the content is a generic exercise demo
// GIF, not recipient data, so there's nothing sensitive being exposed.
router.get(
  '/media/exercise-gif/:catalogId',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'select gif_url from exercise_catalog where id = $1',
      [req.params.catalogId]
    );
    const gifUrl = rows[0]?.gif_url;
    if (!gifUrl) return res.sendStatus(404);

    const upstream = await fetch(gifUrl, {
      headers: { 'X-WorkoutX-Key': process.env.WORKOUTX_API_KEY },
    });
    if (!upstream.ok) return res.sendStatus(502);

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/gif');
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  })
);

module.exports = router;
