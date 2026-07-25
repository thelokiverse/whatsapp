# Build Brief: v2 — Accessibility, Real Onboarding, Honest Dashboard

Context for Claude Code: v1 (Phases 1-5) is built and working — WhatsApp connectivity,
conversation state machine, LLM-based daily plan generation, and a caregiver dashboard.
This is NOT a rewrite. Build on the existing codebase. Read the current implementation
before making changes, and preserve what already works (DB schema, WhatsApp webhook
plumbing, hosting setup).

v2 fixes three specific gaps found during a real usability review before rollout to real
users: (1) exercise instructions are pure English text, not understandable by low-literacy
users, (2) the dashboard shows vanity metrics with actual bugs, not caregiver-actionable
information, (3) there's no way for anyone (including me) to onboard a new person without
manually editing the database.

Note on the current real-world case: neither recipient has major medical conditions, so
the contraindication filter will mostly be a no-op for them specifically. Keep the filter
and validation logic anyway — it's what makes this safe to open-source for someone whose
parent does have a condition, which matters for both the portfolio story and for not
quietly dropping a safety feature just because it isn't needed by the first two users.

Note on v3 direction: exercise plans and media are now AI-generated end to end (Gemini
proposes exercises, a real exercise API resolves them to verified GIFs) rather than
manually curated — see the rewritten Phase 7b. This is a deliberate shift back toward
"let the LLM solve the actual problem" instead of using it as a thin selector over
human-typed content. The one thing that stays fully deterministic (not LLM-dependent) is
a small hard-coded blocklist of disallowed high-risk movement types — cheap to keep,
and it means the system doesn't rely entirely on the model's judgment plus a non-expert's
visual review to catch a bad generation before it reaches an elderly user.

---

## Phase 6 — WhatsApp UX overhaul

### 6a. Replace free-text replies with native WhatsApp Interactive Buttons
- Use WhatsApp Cloud API's `interactive` message type with `type: "button"` (reply buttons),
  max 3 buttons, each label under 20 characters: **Done / Skip / Watch Video**.
- Remove the fuzzy text-matching logic ("yes", "ok", "done", etc.) for these in-flow steps —
  buttons return a reliable `button_reply.id` in the webhook payload, no parsing needed.
- Keep free-text handling only for the very first prompt if you want ("Ready to start?"),
  or convert that to buttons too (Yes / Not now) for consistency — recommend buttons
  everywhere in this flow, it's strictly more reliable for this user base.

### 6b. Media sourcing — see Phase 7b
Media (GIFs/videos) is no longer pre-curated by hand. It's generated dynamically as part
of plan generation — see the rewritten Phase 7b below for the full flow (Gemini proposes
the exercise → a real exercise API resolves it to a verified GIF → a safety blocklist
validates it → it's cached in the exercise catalog for reuse). Nothing to build here in
isolation; Phase 7b covers it end to end.

### 6c. Copy tone
Audit all outbound message copy: never phrase anything as a scold ("You missed 2 days").
Keep it warm and neutral regardless of adherence history. Save any "should I intervene"
signal for the caregiver dashboard only, never in parent-facing messages.

---

## Phase 7 — Onboarding as a real UI (not manual DB entry)

### 7a. New recipient onboarding wizard (web form, part of the dashboard app)
Fields to collect:

| Field | Type | Notes |
|---|---|---|
| Name | text | |
| WhatsApp number | phone, E.164 | show a format example |
| Age | number | currently missing from the data model — add it |
| Height | number + unit | |
| Weight | number + unit | |
| Current activity level | single-select: "Not active" / "Somewhat active" / "Very active" | plain-language version of `mobility_level` — keep as its own explicit question, don't infer it, since it directly gates exercise intensity |
| Medical conditions | free text | mapped to safety tags via Gemini — see step 2 below |
| Preferred workout time | time picker | |
| Timezone | dropdown | default from phone locale |
| Consent | checkbox | required to save |

Steps:
1. Collect the fields above.
2. **Medical conditions — plain English input, mapped by Gemini**: send the free-text
   description + the full tag vocabulary to Gemini, ask it to return a structured JSON
   array of matching tags from the controlled vocabulary only (same structured-output +
   validation pattern already used elsewhere in the app — no free-form tag invention).
   **Show the mapped tags back to the caregiver for confirmation/edit before saving** —
   this is a safety-critical field, never save an LLM-inferred medical tag without human
   confirmation.
3. **Consent checkbox**: "I have explained this system to [name] and they've agreed to
   receive these messages." Store as a boolean + timestamp on the recipient record. Don't
   allow saving without it checked.
4. **Review & generate**: trigger the plan generation described in Phase 7b, then show the
   generated multi-week rotation to the caregiver as an editable calendar — each day's
   entry can be swapped for a different exercise **from the library only** (a dropdown of
   library items filtered by the same contraindication rules, not free text) before
   approving. Nothing goes live until the caregiver explicitly approves.
5. **Send test message**: a button to fire the WhatsApp opt-in/welcome message immediately,
   so the caregiver can confirm delivery works before relying on the schedule.

### 7b. Plan generation: AI-generated exercises, API-verified media

This replaces the earlier "fixed hand-curated list, LLM only selects" design. Gemini now
generates the exercise plan directly using its own fitness knowledge, and a real exercise
API resolves each choice to verified media — no hand-typed exercise list, no LLM-invented
media URLs.

**Flow, per recipient, run once at onboarding and then every ~30 days (or on manual
"Regenerate now"):**

1. **Gemini proposes a multi-week rotation** (suggest 4 weeks): for each day, one
   `warmup` + 2-3 `main` + one `cooldown` exercise, reasoning over the recipient's age,
   height/weight, activity level, and medical-condition tags. Structured output (JSON),
   each exercise as `{ name, session_role, target_area, simple_instruction }`. System
   prompt must explicitly instruct: no jumping/plyometric movement, no floor get-ups
   without support, no heavy free weights, no high-impact cardio — bodyweight/chair/wall-
   supported movements only, appropriate for a frail-to-average-fitness older adult.
2. **Deterministic safety blocklist** (plain code, not LLM-dependent): reject any proposed
   exercise whose name/instruction matches a hard-coded list of disallowed terms/patterns
   (jump, sprint, plyometric, burpee, barbell, heavy, lunge-with-weight, floor without
   support, etc.). If a day's plan has a rejected item, ask Gemini to regenerate just that
   slot (cap at 1 retry, then fall back to a safe default like "seated marching" for that
   slot type rather than retrying indefinitely).
3. **Resolve each surviving exercise to real media**:
   - Query the WorkoutX exercise API (free tier) by the exercise name/keywords, filtered
     to `equipment=body weight` and `difficulty=beginner` where possible, to get a real,
     hosted `gifUrl`.
   - Query the YouTube Data API search endpoint for a real, existing video matching the
     exercise name, to get a real `videoUrl`. Do not accept a URL from Gemini directly —
     only from these API responses.
   - If no reasonable match is found for either, don't block the plan — fall back to a
     text-only version of that exercise (better a missing GIF than a broken/wrong one).
4. **Save to the exercise catalog** (see data model below) so the same exercise doesn't
   need to be re-resolved via API on a future occasion — check the catalog for an existing
   match before calling the APIs.
5. **Contraindication check**: still validate the final plan against the recipient's
   medical-condition tags before saving — if a generated exercise's target area or name
   matches a known contraindication (e.g. anything knee-loading for someone with
   `knee_pain`), drop it and regenerate that slot. Keep this as a real validation step, not
   just a prompt instruction.
6. **Present to the caregiver for review**: render each day's exercises with their actual
   fetched GIF inline (not just a URL) so the review step is meaningful. Caregiver can
   swap any single exercise (triggers a fresh generate-and-resolve for just that slot) or
   approve the whole rotation.
7. Store `plan_generated_at` and `plan_valid_until`. Auto-apply subsequent monthly
   regenerations without requiring re-approval (per your call — revisit this after a
   month of real usage data if it turns out you want the checkpoint back).

**Data model change**: replace the static `exercise-library.json` seed with a DB table:
```
exercise_catalog
  id, name, session_role, target_area, simple_instruction,
  gif_url, video_url, source ("workoutx" / "youtube" / "fallback_text_only"),
  contraindication_tags (jsonb), created_at
```
The old JSON file's tag vocabulary (contraindication tag names, `session_role` values,
`area` values) is still useful as a reference for prompting Gemini's structured output and
for the blocklist — keep it as documentation, not as literal seed rows.

### 7c. Data model additions
```
care_recipients
  + age (int)
  + consent_given (bool)
  + consent_given_at (timestamp)

Add or extend a table for the multi-week rotation, e.g.:
plan_rotations
  id, care_recipient_id (fk), generated_at, valid_until,
  daily_sequences (jsonb — array of {day_offset, exercise_ids})
```

---

## Phase 8 — Dashboard redesign (fix bugs, then redesign around one question)

### 8a. Fix the known bug first
The calendar widget colors the wrong cell (rightmost instead of leftmost, or vice versa) —
this is a data-to-cell index mapping bug. Find and fix the root cause (likely a reversed
array or off-by-one in the day-index-to-grid-column mapping) rather than patching the
visual output. Write a quick test with known input dates to confirm the fix.

### 8b. Redesign principle
Every element on this dashboard should answer, at a glance: **"does this person need me to
step in?"** Cut anything that doesn't serve that. Suggested layout:

- **Top banner, conditional**: only appears if there's something to act on — e.g.
  "⚠️ No response in 2 days" or "⚠️ 3 exercises skipped this week — worth checking in?"
  Otherwise show a quiet "on track" state. This is the single most useful thing on the
  page and currently doesn't exist.
- **Trend, not just a snapshot**: adherence this week vs. last week (a simple sparkline
  or two-bar comparison), not just a bare 7-day percentage with no context for whether
  that's good or bad.
- **Streak**: keep this, it's genuinely useful and already exists.
- **Calendar heatmap**: keep, once the bug is fixed — but handle empty states explicitly
  ("No plan yet" should look clearly different from "no data available," not the same
  gray box).
- **Response timing pattern** (new): are they responding near the scheduled time, or
  consistently very late/not until prompted twice? This is a leading indicator worth
  surfacing before adherence % drops.
- **Most-skipped exercise**: keep, but only show it if skip count is meaningful (e.g. ≥2),
  and frame it as "worth checking if this one is uncomfortable for them" rather than a
  bare stat.

Cut or rethink anything currently on the dashboard that doesn't map to one of the above.

---

## Phase 9 — Reliability (light touch, don't over-build)

- Log and retry (once) any failed WhatsApp send (rate limit / transient network error);
  surface failed sends distinctly in the dashboard/logs so a missing message isn't
  misread as "they ignored it."
- Confirm webhook signature verification is in place (if not already) so the endpoint
  only accepts genuine Meta webhook calls.
- Cache WhatsApp media IDs for the generated GIFs (per Phase 6b) so they're uploaded once,
  not re-uploaded on every send.

---

## Order of work
Build in phase order (6 → 7 → 8 → 9). Within Phase 6, do the media audit (6b, step 1-2)
FIRST, before touching any code — it determines the final exercise list, which Phase 7's
onboarding/plan-generation logic depends on. Get one exercise's full pipeline (download →
store → upload to WhatsApp Media API → send with buttons) working end-to-end and confirmed
on your own WhatsApp number before doing the rest, so you're not debugging content sourcing
and message delivery at the same time.
