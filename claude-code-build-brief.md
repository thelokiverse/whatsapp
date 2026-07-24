# Build Brief: WhatsApp-Native Senior Fitness Companion

Paste this entire document to Claude Code as your opening prompt in a new project folder.
Work through it phase by phase — do NOT let Claude Code attempt everything in one shot.

---

## 1. What we're building (one-liner)

A system that sends 2 specific senior citizens (my parents) a WhatsApp message each evening,
walks them through 3-4 pre-approved low-impact exercises one at a time (via reply-driven
conversation), logs completion, and gives me (the caregiver) a private web dashboard to see
adherence over time.

## 2. Non-goals (explicitly out of scope for v1 — do not build these)

- No medical diagnosis, alerts, or emergency detection of any kind.
- No LLM-generated exercises from scratch — the LLM may only SELECT and SEQUENCE from the
  fixed `exercise-library.json` file provided.
- No dashboard access for the parents themselves — dashboard is caregiver-only, behind auth.
- No support for arbitrary/unknown users — this is a fixed allowlist of 2 phone numbers.
- No payment, no multi-tenant SaaS behavior. This is a personal tool, portfolio-quality code.

## 3. Users

- **Care recipients (2 fixed people)**: interact ONLY via WhatsApp. Low tech literacy.
  Messages to them must be short, simple, one action at a time, no jargon.
- **Caregiver (me)**: interacts via a simple web dashboard + one-time onboarding form per parent.

## 4. Tech stack (all free-tier, no paid services)

- **Backend**: Node.js + Express (or Python + FastAPI — pick one and stay consistent)
- **Database**: Postgres via Supabase free tier (or Neon free tier)
- **Messaging**: WhatsApp Cloud API (official Meta API, NOT a third-party BSP) — free for
  our volume (well under the 1,000 free service-conversation/month allowance)
- **LLM**: Google Gemini free tier API (or Groq free tier) — used only for the
  "select + sequence exercises" step, with STRUCTURED OUTPUT (JSON mode / function calling),
  constrained to IDs that exist in exercise-library.json. Never let it free-generate text
  describing new exercises.
- **Scheduler**: node-cron (or APScheduler in Python) running inside the same backend process,
  OR a free external cron (cron-job.org / Render's built-in cron) hitting a `/trigger-daily`
  endpoint — prefer the external cron approach since free hosting tiers can sleep/restart.
- **Hosting**: Render or Railway free web service tier
- **Frontend (dashboard)**: a simple React (Vite) app or plain server-rendered HTML —
  keep it simple, this is not the hard part of the project
- **Version control**: GitHub, public repo (good for portfolio visibility)

## 5. Data model (tables)

```
care_recipients
  id, name, phone_number (E.164 format), height_cm, weight_kg,
  medical_conditions (text[] or jsonb — tags like "knee_pain", "hip_pain", "cardiac", "balance_disorder"),
  mobility_level (enum: low / medium / high),
  preferred_time (time, default 19:00),
  timezone,
  created_at

daily_plans
  id, care_recipient_id (fk), date,
  exercise_ids (jsonb array, e.g. ["ex_01","ex_04","ex_09"]),
  status (enum: pending / sent / in_progress / completed / skipped / no_response),
  created_at

session_logs
  id, daily_plan_id (fk), exercise_id,
  sent_at, completed_at, skipped (bool)

message_log
  id, care_recipient_id (fk), direction (in/out), body, whatsapp_message_id, created_at

caregiver_users
  id, email, password_hash   -- for dashboard auth, keep this minimal (1-2 users max)
```

## 6. WhatsApp conversation flow (state machine)

```
[Scheduled trigger at preferred_time]
  → Bot sends: "Hi {name}! Time for your evening exercises 💪 Ready to start? Reply YES to begin."
  → status: sent

  On reply "yes"/"ok"/similar (fuzzy match, be forgiving of typos and language):
    → status: in_progress
    → Send exercise 1: name + simple instruction + GIF/short clip + "Reply DONE when finished, or SKIP to move on."

  On reply "done":
    → log completion in session_logs
    → if more exercises remain → send next exercise
    → if none remain → send closing message with today's score
        e.g. "Great job! You completed 3/3 exercises today. 🔥 4-day streak!"
    → status: completed

  On reply "skip":
    → log as skipped, move to next exercise (or closing message if last)

  If no reply within ~2 hours of the initial prompt:
    → send ONE gentle follow-up ("No rush — still want to do today's exercises? Reply YES anytime before bed.")
    → if still no reply by a cutoff (e.g. 9:30pm) → mark status: no_response, no further nagging that day

  Any unrecognized reply:
    → respond with a simple clarifying nudge, don't loop forever, don't error out silently
```

Keep ALL outbound copy at a 5th-grade reading level, one instruction per message, no compound
sentences. This matters more than any other single design decision in this project.

## 7. Daily plan generation logic

Runs once per recipient, ahead of their preferred_time (e.g. via cron at midnight, or lazily
on first trigger of the day):

1. Fetch recipient's medical_conditions and mobility_level.
2. Filter exercise-library.json to exclude any exercise whose `contraindications` overlap
   with the recipient's medical_conditions.
3. Send the FILTERED list (not the full library) to the LLM with a system prompt like:
   "Given this person's profile [profile json] and this allowed list of exercises [filtered json],
   select exactly 3-4 exercises that give a balanced mix of areas (legs/arms/balance/flexibility),
   are appropriate for mobility_level={x}, and are NOT identical to the exercises used in their
   last 2 days [recent history]. Return ONLY a JSON array of exercise IDs from the provided list.
   Do not invent new exercises or IDs."
4. Validate the LLM's returned IDs actually exist in the filtered list (defensive check — if
   validation fails, fall back to a simple rotation/round-robin instead of retrying the LLM
   indefinitely).
5. Store as daily_plans row.

## 8. Dashboard requirements (caregiver-only, simple auth)

- Login (simple email/password is fine — this is a 1-2 user internal tool, not enterprise auth)
- Per-recipient view: adherence % (last 7/30 days), current streak, calendar heatmap of
  completed/skipped/no_response days, most-skipped exercises
- No PHI beyond what's needed — this is a personal project, but still don't log more than
  necessary, and don't commit real phone numbers or medical data to the public GitHub repo
  (see Section 10).

## 9. Build phases — build and verify each before moving to the next

**Phase 1 — Foundation**
- Repo scaffold, DB schema + migrations, seed exercise-library.json into DB
- Basic Express/FastAPI server with health check endpoint
- Deploy skeleton to Render/Railway, confirm it's live

**Phase 2 — WhatsApp connectivity**
- Wire up WhatsApp Cloud API webhook (receive messages)
- Send a manual test message to your own number successfully
- Confirm webhook receives and logs inbound replies

**Phase 3 — Conversation state machine**
- Implement the full flow from Section 6 for ONE hardcoded recipient
- Test the entire loop manually via your own WhatsApp number before involving real parents

**Phase 4 — LLM plan generation**
- Implement Section 7 logic
- Unit test with 3-4 different fake profiles to confirm contraindication filtering works
  BEFORE connecting it to the live message flow

**Phase 5 — Dashboard**
- Build read-only dashboard reading from the same DB
- Add simple auth

**Phase 6 — Real rollout**
- Onboard the 2 real recipients (see Section 11 for consent notes)
- Monitor closely for the first week, be ready to intervene manually

Do not skip ahead to Phase 6 before Phases 1-5 are each independently verified.

## 10. Security / hygiene requirements

- `.env` file for all secrets (WhatsApp token, DB connection string, LLM API key) —
  MUST be in `.gitignore`, never committed
- No real names, phone numbers, or medical conditions committed to the public repo, even in
  seed/test data — use obviously fake placeholder data in any committed fixtures
- README should explain the project, architecture, and setup steps generically (for portfolio
  viewers) without needing real credentials to understand the design

## 11. One important human note (not a coding task)

Before onboarding your real parents, get their explicit verbal okay that:
- You'll see their exercise completion status
- Messages come from an automated system, not you personally
- They can stop anytime by saying so

This isn't a compliance requirement for a personal project, but it's the right thing to do,
and it's worth mentioning in your portfolio write-up as a product decision you made deliberately.

---

## Files to bring into the repo before starting
- `exercise-library.json` (provided separately — seed data, do not let the LLM regenerate it)
