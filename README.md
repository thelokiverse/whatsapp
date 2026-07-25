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

## Security / hygiene notes

- All secrets live in `.env`, which is gitignored and never committed.
- No real names, phone numbers, or medical data are committed to this repo — any seed/test
  fixtures use obviously fake placeholder data.
- The dashboard is caregiver-only; recipients interact exclusively over WhatsApp.

## Build phases

This project is built incrementally and verified phase by phase:

1. **Foundation** — repo scaffold, DB schema, seed data, health check, deploy skeleton.
2. **WhatsApp connectivity** — webhook wiring, manual test message, inbound reply logging.
3. **Conversation state machine** — full reply-driven exercise flow for one recipient.
4. **LLM plan generation** — contraindication-aware exercise selection, validated against the
   fixed library, with a rotation fallback if validation fails.
5. **Dashboard** — read-only caregiver view: adherence, streaks, calendar heatmap.
6. **Real rollout** — onboarding real recipients, after their explicit verbal consent.

Current status: **Phase 4 (LLM plan generation) complete.** Contraindication filtering and
selection validated against 4 fake profiles (`backend/scripts/test-plan-selection.js`) before
ever touching the live message flow.

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
