# WhatsApp-Native Senior Fitness Companion

A system that sends a small, fixed set of senior citizens a WhatsApp message each evening,
walks them through a few pre-approved low-impact exercises one at a time via reply-driven
conversation, logs completion, and gives a caregiver a private web dashboard to see adherence
over time.

This is a personal/portfolio project, not a commercial product. It intentionally avoids any
medical diagnosis, alerting, or emergency-detection functionality — see "Non-goals" below.

## Architecture

```
Scheduled trigger (external cron) ──▶ /trigger-daily ──▶ Backend (Express)
                                                              │
                                                     ┌────────┴────────┐
                                                     │                 │
                                              WhatsApp Cloud API   Postgres (Supabase)
                                              (send/receive msgs)      │
                                                     │                 │
                                              LLM (Gemini)      Caregiver Dashboard
                                        (select+sequence only,      (React, auth-gated)
                                         constrained to a fixed
                                         exercise library)
```

- **Backend**: Node.js + Express
- **Database**: Postgres (Supabase free tier)
- **Messaging**: WhatsApp Cloud API (official Meta API)
- **LLM**: Google Gemini (free tier) — used only to *select and sequence* exercises from a
  fixed, human-curated `exercise-library.json`. It never generates new exercises or free text
  describing exercises.
- **Scheduler**: external cron (e.g. cron-job.org) hitting a `/trigger-daily` endpoint, since
  free hosting tiers can sleep/restart and an in-process scheduler isn't reliable there.
- **Dashboard**: React (Vite), caregiver-only, behind simple email/password auth.
- **Hosting**: Render free tier.

## Non-goals (v1)

- No medical diagnosis, alerts, or emergency detection.
- No LLM-generated exercises — the LLM only selects/sequences from the fixed exercise library.
- No dashboard access for care recipients — caregiver-only, behind auth.
- No support for arbitrary/unknown users — fixed allowlist of recipients.
- No payments, no multi-tenant behavior.

## Data model

See [`backend/src/db/schema.sql`](backend/src/db/schema.sql) for the full schema:
`care_recipients`, `daily_plans`, `session_logs`, `message_log`, `caregiver_users`,
`exercise_library`.

## Project structure

```
backend/
  src/
    config/      # DB pool, env config
    db/          # schema.sql
    routes/      # Express routes (health, webhook, dashboard API, ...)
    services/    # business logic (conversation state machine, plan generation, ...)
    whatsapp/    # WhatsApp Cloud API client + message templates
    llm/         # Gemini client + prompt + validation
    app.js       # Express app factory
    index.js     # server entry point
  scripts/
    migrate.js   # applies schema.sql
    seed.js      # seeds exercise-library.json into the DB
dashboard/       # React (Vite) caregiver dashboard (added in a later phase)
exercise-library.json  # fixed, human-curated exercise data (never LLM-generated)
```

## Local setup

1. **Database**: create a free [Supabase](https://supabase.com) project, copy the Postgres
   connection string.
2. Copy `backend/.env.example` to `backend/.env` and fill in `DATABASE_URL` (and other keys as
   later phases require). `.env` is gitignored and never committed.
3. Install dependencies and run migrations + seed:
   ```bash
   cd backend
   npm install
   npm run migrate
   npm run seed
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Check it's alive: `curl http://localhost:3000/health`

## Gotcha: WhatsApp's 24-hour session window

The Cloud API only allows free-form (non-template) messages within 24 hours of the recipient
last messaging the business number — otherwise sends fail with error `131047`
("Re-engagement message"), even though the API call itself returns a success response with a
message ID. This makes send failures easy to miss: check the `statuses` webhook payload (not
just the initial send response) to catch them. In production this is handled by having the
recipient message in first, or by using pre-approved message templates outside the window.

## Gotcha: webhook field subscription is separate from callback verification

Verifying the webhook callback URL (the `GET` handshake with `hub.challenge`) only proves Meta
can reach your endpoint — it does not subscribe you to any events. In the Meta App dashboard,
under WhatsApp → Configuration, the `messages` field must also be explicitly subscribed, or no
webhook calls will ever arrive despite a "verified" callback URL.

## Gotcha: WhatsApp's Media API rejects animated GIFs outright

Exercise demo GIFs (from the WorkoutX exercise API) can't be sent to WhatsApp as-is - the
Cloud API's Media upload endpoint only accepts `image/jpeg`, `image/png`, `image/webp`,
`video/mp4`, and `video/3gpp` for images/video (confirmed by testing, not just docs: a raw
`image/gif` upload attempt returns a `400` naming the exact allowed list). There's no
"animated image" type. Fix: convert the GIF to a small MP4 with `ffmpeg-static` (a bundled
static binary - no system-level `ffmpeg` install needed, works on Render's free tier) before
uploading, then use the interactive message's `header.type: "video"` (not `"image"`) with
the resulting WhatsApp media ID. Also note: WorkoutX's own `gifUrl` requires their API key
to fetch (401 without it, via the `X-WorkoutX-Key` header or an `api-key` query param) - so
GIFs must be downloaded server-side with our key, never passed through to WhatsApp as a
public link directly.

## Gotcha: WorkoutX's exercise search is exact-substring, not fuzzy

`GET /v1/exercises?name=...` only matches a literal substring of the exercise name, and the
dataset itself skews toward a general gym-equipment catalog (Barbell/Cable/Lever variants
dominate) rather than senior-friendly plain names. Multi-word AI-generated names like "Seated
Marching" or "Chair Sit-to-Stand" very often return zero results even though the underlying
movement exists under a different name. `workoutxClient.js` handles this with two query
attempts (the full name, then a qualifier-stripped phrase) and - more importantly - hard
filters (and a name-overlap check) rather than "best of the results" scoring: a match must be
`difficulty: beginner` + `equipment: Body Weight`, non-plyometric, non-vigorous, *and* share a
real word with the proposed name. Early attempts without the overlap check produced matches
like "Wall Push-ups" → "Butt-ups" - technically "qualified" by the safety filters but a
completely different exercise. Expect a real hit rate around 15-25%; everything else falls
back to text-only, which is the intended, safer outcome per the brief ("better a missing GIF
than a broken/wrong one").

## Security / hygiene notes

- All secrets live in `.env`, which is gitignored and never committed.
- No real names, phone numbers, or medical data are committed to this repo — any seed/test
  fixtures use obviously fake placeholder data.
- The dashboard is caregiver-only; recipients interact exclusively over WhatsApp.

## Build phases

This project is built incrementally and verified phase by phase.

**v1:**
1. **Foundation** — repo scaffold, DB schema, seed data, health check, deploy skeleton.
2. **WhatsApp connectivity** — webhook wiring, manual test message, inbound reply logging.
3. **Conversation state machine** — full reply-driven exercise flow for one recipient.
4. **LLM plan generation** — contraindication-aware exercise selection, validated against the
   fixed library, with a rotation fallback if validation fails.
5. **Dashboard** — read-only caregiver view: adherence, streaks, calendar heatmap.

**v2** (see [`v2-build-brief.md`](v2-build-brief.md) for full scope):
6. **WhatsApp UX overhaul** — native interactive buttons replace free-text matching.
7. **Real onboarding** — a caregiver-facing wizard replaces manual DB entry; Gemini
   generates a full 28-day exercise plan (not just selection from a fixed list), with a
   deterministic safety blocklist, contraindication re-check, and real demo media resolved
   via the WorkoutX API.
8. **Dashboard redesign** — restructured around "does this person need me to step in?"
   (alerts, adherence trend, response timing) instead of a bare adherence percentage.
9. **Reliability** — retry logic, webhook signature verification, distinct failed-send
   surfacing, media ID cache refresh.

**Not yet built:** onboarding real recipients (the user's actual parents) with their
explicit verbal consent — the system is fully built and verified with test data, but no
real person has been onboarded yet.

Current status: **v2 complete (Phases 6-9).** WhatsApp replies use native interactive
buttons instead of free-text matching; a real onboarding wizard generates AI-authored,
safety-validated 28-day exercise plans with real demo media resolved via the WorkoutX API;
the caregiver dashboard is redesigned around "does this person need me to step in?" instead
of bare vanity metrics; and the backend has retry logic, webhook signature verification, and
distinct failed-send surfacing. All four phases verified live against the deployed backend
and real Gemini/WorkoutX/WhatsApp APIs. See [`v2-build-brief.md`](v2-build-brief.md) for the
full scope.

## Gotcha: Gemini model names churn quickly - verify against the live API, not docs

`gemini-2.5-flash` (the model shown in the SDK's own README example, and in most tutorials as of
mid-2026) returned `404 "no longer available to new users"` for a freshly created API key.
`gemini-2.0-flash` and `gemini-2.5-flash-lite` were also unavailable. Don't trust a model name
from documentation or search results without checking - call `GET /v1beta/models` with your
actual key to see what your account can use, and smoke-test `generateContent` directly against a
candidate before wiring it into application code:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | jq -r '.models[] | select(.supportedGenerationMethods[]? == "generateContent") | .name'
```

This project ended up on `gemini-3.5-flash`. Also expect occasional transient `503 UNAVAILABLE`
("high demand") errors - the rotation fallback in `planSelection.js` handles these the same way
as an invalid response, by design (see Section 7 of the build brief: don't retry the LLM
indefinitely).

## Gotcha: Supabase direct connection vs. connection pooler

Supabase's "direct connection" host (`db.<ref>.supabase.co`) resolves to an IPv6 address only.
Render's free tier egress is IPv4-only, so the direct connection string works locally (if your
machine has IPv6) but fails to connect from Render. Use Supabase's **connection pooler** string
instead (`Project Settings > Database > Connect > Connection pooling`), which resolves to IPv4
addresses and works from both environments.

## Gotcha: pg's DATE parsing depends on the Node process's local timezone

Postgres `DATE` columns come back from `node-postgres` as JS `Date` objects converted using the
*Node process's* local timezone - not UTC, and not the database session's timezone (which is a
third, independent value; `current_date` in SQL uses the DB server's session timezone). All
three can disagree, so calendar-day logic (streaks, adherence, the dashboard heatmap) can be
correct in one environment and off by a day in another. Fixed by keeping `DATE` columns as raw
`'YYYY-MM-DD'` strings (`pg.types.setTypeParser(1082, v => v)` in `config/db.js`) and doing all
day arithmetic with a pure string helper (`addDaysToDateString`, anchored at UTC noon) relative
to each recipient's own `timezone` column - never relying on the server's or Postgres's notion
of "today."

## Gotcha: Express 4 async route handlers can crash the whole process

An unhandled rejection inside an `async (req, res) => {...}` Express 4 route handler isn't
caught by Express - the promise is simply discarded, and Node's default behavior since v15 is to
crash the process on an unhandled rejection. This bit us for real: a missing `JWT_SECRET` on
Render made `jwt.sign()` throw inside `POST /auth/login`, which killed the whole backend
(including the WhatsApp bot running in the same process) until Render restarted it. Fixed with
an `asyncHandler` wrapper (`middleware/asyncHandler.js`) on every async route plus a global
Express error-handling middleware, so a bad request returns a 500 instead of taking down
messaging for real recipients. `index.js` also logs `unhandledRejection`/`uncaughtException` as
a last-resort safety net.
