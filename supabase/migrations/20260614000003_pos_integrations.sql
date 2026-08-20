-- POS Integrations — Square (v1), extensible to Lightspeed / Toast / TouchBistro later.
-- Stores OAuth tokens server-side; clients can only read their own row (never the token).
-- Token reads for order-push and catalog-sync happen via service-role edge functions.

-- ── pos_integrations ────────────────────────────────────────────────────────────

create table if not exists pos_integrations (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users(id) on delete cascade,
    pos_type         text not null check (pos_type in ('square', 'lightspeed', 'toast', 'touchbistro')),
    access_token     text not null,
    refresh_token    text,
    token_expires_at timestamptz,
    merchant_id      text,
    merchant_name    text,
    location_id      text,       -- Primary Square location — used when pushing orders
    is_active        boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (user_id, pos_type)
);

alter table pos_integrations enable row level security;

-- Bakers can view connection status (never the token — that column is server-only)
create policy "pos_select_own" on pos_integrations
    for select using (auth.uid() = user_id);

-- Bakers can disconnect (delete) their own integration
create policy "pos_delete_own" on pos_integrations
    for delete using (auth.uid() = user_id);

-- Insert / update only via service-role edge functions (token exchange happens server-side)

-- ── pos_sync_log ─────────────────────────────────────────────────────────────────

create table if not exists pos_sync_log (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    pos_type      text not null,
    direction     text not null check (direction in ('push_order', 'pull_catalog')),
    bakeri_id     text,   -- Bakeri order ID or "N items" for catalog sync
    pos_id        text,   -- Square order ID created on the POS side
    status        text not null check (status in ('success', 'failed')),
    error_message text,
    created_at    timestamptz not null default now()
);

alter table pos_sync_log enable row level security;

create policy "pos_log_select_own" on pos_sync_log
    for select using (auth.uid() = user_id);

-- ── menu_items: add POS tracking columns ─────────────────────────────────────────

alter table menu_items
    add column if not exists pos_item_id text,
    add column if not exists pos_type    text;

-- Unique constraint for catalog-sync upsert (one POS item ID per user)
create unique index if not exists menu_items_user_pos_item_idx
    on menu_items (user_id, pos_item_id)
    where pos_item_id is not null;
