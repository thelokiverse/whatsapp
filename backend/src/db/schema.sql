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
