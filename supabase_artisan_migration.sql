-- ============================================================
-- Bakeri — Artisan Applications Migration
-- Run this in your Supabase dashboard: SQL Editor → New Query
-- ============================================================

-- ── Artisan Applications ──────────────────────────────────────
-- Stores applications submitted via the Bakeri Artisan Program
-- landing page. Inserted by anonymous (public) users.

create table if not exists public.artisan_applications (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  handle      text not null,
  followers   text not null,
  bio         text not null,
  status      text not null default 'pending',   -- pending | approved | rejected
  created_at  timestamptz not null default now()
);

-- Prevent duplicate applications from the same email
alter table public.artisan_applications
  add constraint artisan_applications_email_unique unique (email);

-- Enable RLS
alter table public.artisan_applications enable row level security;

-- Anyone (including unauthenticated visitors) can submit an application.
-- The anon key used in the landing page JS is sufficient.
create policy "Public can insert artisan applications"
  on public.artisan_applications
  for insert
  to anon
  with check (true);

-- Only authenticated users (you, as the admin) can read applications.
-- Access the data via the Supabase dashboard or a service-role key.
create policy "Authenticated users can read artisan applications"
  on public.artisan_applications
  for select
  to authenticated
  using (true);
