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

Current status: **Phase 1 (Foundation) complete.** Backend deployed and verified live on Render,
connected to Supabase Postgres.

## Gotcha: Supabase direct connection vs. connection pooler

Supabase's "direct connection" host (`db.<ref>.supabase.co`) resolves to an IPv6 address only.
Render's free tier egress is IPv4-only, so the direct connection string works locally (if your
machine has IPv6) but fails to connect from Render. Use Supabase's **connection pooler** string
instead (`Project Settings > Database > Connect > Connection pooling`), which resolves to IPv4
addresses and works from both environments.
