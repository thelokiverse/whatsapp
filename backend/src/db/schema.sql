-- WhatsApp Flow: core schema
-- Safe to re-run: uses IF NOT EXISTS everywhere.

create extension if not exists pgcrypto;

create table if not exists care_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text not null unique, -- E.164 format, e.g. +15551234567
  height_cm numeric,
  weight_kg numeric,
  medical_conditions jsonb not null default '[]'::jsonb, -- e.g. ["knee_pain", "cardiac"]
  mobility_level text not null check (mobility_level in ('low', 'medium', 'high')),
  preferred_time time not null default '19:00',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table if not exists daily_plans (
  id uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  date date not null,
  exercise_ids jsonb not null default '[]'::jsonb, -- e.g. ["ex_01", "ex_04", "ex_09"]
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'in_progress', 'completed', 'skipped', 'no_response')),
  created_at timestamptz not null default now(),
  unique (care_recipient_id, date)
);

-- When the initial "ready to start?" prompt was sent, and when the 2hr no-response
-- nudge was sent (if it was) - drives the follow-up/timeout logic in Section 6.
alter table daily_plans add column if not exists prompt_sent_at timestamptz;
alter table daily_plans add column if not exists followup_sent_at timestamptz;

create table if not exists session_logs (
  id uuid primary key default gen_random_uuid(),
  daily_plan_id uuid not null references daily_plans(id) on delete cascade,
  exercise_id text not null,
  sent_at timestamptz,
  completed_at timestamptz,
  skipped boolean not null default false
);

create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  whatsapp_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists caregiver_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Seed data table for exercise-library.json (read-only reference data, never LLM-written)
create table if not exists exercise_library (
  id text primary key,
  data jsonb not null
);

create index if not exists idx_daily_plans_recipient_date on daily_plans (care_recipient_id, date);
create index if not exists idx_message_log_recipient on message_log (care_recipient_id, created_at);

-- v2 additions (see v2-build-brief.md)

alter table care_recipients add column if not exists age int;
alter table care_recipients add column if not exists consent_given boolean not null default false;
alter table care_recipients add column if not exists consent_given_at timestamptz;
alter table care_recipients add column if not exists activity_level text
  check (activity_level in ('not_active', 'somewhat_active', 'very_active'));

-- Replaces exercise_library for new (rotation-based) plans. Exercises are now
-- proposed by Gemini and resolved to real media via the WorkoutX exercise API,
-- rather than hand-typed. exercise_library stays untouched as the fallback
-- path for any recipient without an active plan_rotations row.
create table if not exists exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session_role text not null check (session_role in ('warmup', 'main', 'cooldown')),
  target_area text not null,
  simple_instruction text not null,
  duration_or_reps text not null,
  gif_url text, -- WorkoutX's source URL, kept for reference/re-conversion, not sent directly to WhatsApp
  video_media_id text, -- WhatsApp media ID for the converted mp4 (see whatsapp/mediaCache.js)
  video_url text, -- optional external video link (e.g. YouTube), shown as text, not uploaded
  source text not null default 'gemini'
    check (source in ('workoutx', 'gemini', 'fallback_text_only')),
  contraindication_tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exercise_catalog_name on exercise_catalog (lower(name));

-- Multi-week (28-day) exercise blueprint per recipient, generated at onboarding
-- and regenerated periodically. daily_plans (per-day tracking) derives its
-- exercise_ids from the active rotation instead of calling the LLM fresh each day.
create table if not exists plan_rotations (
  id uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  generated_at timestamptz not null default now(),
  valid_until timestamptz not null,
  daily_sequences jsonb not null, -- [{day_offset, exercise_ids: [uuid, ...]}]
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'active', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists idx_plan_rotations_recipient
  on plan_rotations (care_recipient_id, valid_until);

-- Caches WhatsApp media IDs for uploaded exercise videos, so the same file
-- isn't re-uploaded on every send (WhatsApp media IDs are valid ~30 days).
create table if not exists media_cache (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  whatsapp_media_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tracks failed sends distinctly, so a delivery failure isn't misread as
-- "they ignored it" (Phase 9).
alter table message_log add column if not exists send_failed boolean not null default false;
alter table message_log add column if not exists retry_at timestamptz;
