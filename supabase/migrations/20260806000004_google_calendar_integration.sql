-- Google Calendar sync — one-way push (Bakeri → Google) of baking tasks and orders
-- to a dedicated "Bakeri Schedule" calendar. Stores OAuth tokens server-role only;
-- clients can only read connection status and disconnect, never the token —
-- same rationale as pos_integrations (20260614000003_pos_integrations.sql).
-- Token exchange, refresh, and event push all happen via service-role edge functions.

-- ── calendar_integrations ────────────────────────────────────────────────────────

create table if not exists calendar_integrations (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    provider         text not null check (provider in ('google')),
    access_token     text not null,
    refresh_token    text,
    token_expires_at timestamptz,
    calendar_id      text not null,  -- the dedicated "Bakeri Schedule" calendar created on connect
    account_email    text,           -- display only
    is_active        boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (user_id, provider)
);

alter table calendar_integrations enable row level security;

-- Bakers can view connection status (never the token — that column is server-only)
create policy "calendar_integrations_select_own" on calendar_integrations
    for select using (auth.uid() = user_id);

-- Bakers can disconnect (delete) their own integration. The Google-side calendar
-- and its events are left in place — disconnecting only stops future pushes.
create policy "calendar_integrations_delete_own" on calendar_integrations
    for delete using (auth.uid() = user_id);

-- Insert / update only via service-role edge functions (token exchange/refresh
-- happens server-side)

-- ── calendar_synced_events ───────────────────────────────────────────────────────
-- Maps a Bakeri baking_task/order to the Google event it was pushed as, so sync
-- is idempotent (update in place instead of duplicating) and deletable. Fully
-- server-role — no client policies, so RLS blocks all client access by default.

create table if not exists calendar_synced_events (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    source_type       text not null check (source_type in ('baking_task', 'order')),
    source_id         uuid not null,
    google_event_id   text not null,
    source_updated_at timestamptz not null,
    created_at        timestamptz not null default now(),
    unique (user_id, source_type, source_id)
);

alter table calendar_synced_events enable row level security;

create index if not exists calendar_synced_events_user_idx on calendar_synced_events (user_id);
