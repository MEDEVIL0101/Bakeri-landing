-- ============================================================
-- Bakeri — Supabase Migration
-- Run this in your Supabase dashboard: SQL Editor → New Query
-- ============================================================

-- ── Recipes ──────────────────────────────────────────────────
create table if not exists public.recipes (
  id                  uuid primary key,
  user_id             uuid references auth.users on delete cascade not null,
  name                text not null,
  yield_quantity      double precision not null default 1,
  yield_unit          text not null default 'pieces',
  prep_time_minutes   int  not null default 0,
  bake_time_minutes   int  not null default 0,
  instructions        text not null default '',
  notes               text not null default '',
  tags                text[] not null default '{}',
  is_favorite         bool not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
alter table public.recipes enable row level security;
create policy "Users manage own recipes"
  on public.recipes for all using (auth.uid() = user_id);

-- ── Recipe Ingredients ────────────────────────────────────────
create table if not exists public.recipe_ingredients (
  id              uuid primary key,
  user_id         uuid references auth.users on delete cascade not null,
  recipe_id       uuid references public.recipes on delete cascade not null,
  name            text not null,
  volume_amount   double precision not null default 0,
  volume_unit     text not null default 'cup',
  grams_per_cup   double precision not null default 0,
  notes           text not null default '',
  sort_order      int  not null default 0,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
alter table public.recipe_ingredients enable row level security;
create policy "Users manage own ingredients"
  on public.recipe_ingredients for all using (auth.uid() = user_id);

-- ── Orders ───────────────────────────────────────────────────
create table if not exists public.orders (
  id               uuid primary key,
  user_id          uuid references auth.users on delete cascade not null,
  order_name       text not null default '',
  customer_name    text not null,
  customer_phone   text not null default '',
  customer_email   text not null default '',
  due_date         timestamptz not null,
  status           text not null default 'confirmed',
  notes            text not null default '',
  is_paid          bool not null default false,
  payment_note     text not null default '',
  deposit_amount   double precision not null default 0,
  deposit_note     text not null default '',
  fulfillment_type text not null default 'pickup',
  delivery_details text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
alter table public.orders enable row level security;
create policy "Users manage own orders"
  on public.orders for all using (auth.uid() = user_id);

-- ── Order Items ───────────────────────────────────────────────
create table if not exists public.order_items (
  id             uuid primary key,
  user_id        uuid references auth.users on delete cascade not null,
  order_id       uuid references public.orders on delete cascade not null,
  recipe_id      uuid references public.recipes on delete set null,
  custom_name    text not null default '',
  quantity       double precision not null default 1,
  unit           text not null default 'pieces',
  price_per_unit double precision not null default 0,
  notes          text not null default '',
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
alter table public.order_items enable row level security;
create policy "Users manage own order items"
  on public.order_items for all using (auth.uid() = user_id);

-- ── Menu Items ────────────────────────────────────────────────
create table if not exists public.menu_items (
  id                 uuid primary key,
  user_id            uuid references auth.users on delete cascade not null,
  recipe_id          uuid references public.recipes on delete set null,
  name               text not null,
  item_description   text not null default '',
  category           text not null default '',
  default_quantity   double precision not null default 1,
  unit               text not null default 'pieces',
  default_price      double precision not null default 0,
  is_active          bool not null default true,
  sort_order         int  not null default 0,
  linked_recipe_name text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
alter table public.menu_items enable row level security;
create policy "Users manage own menu items"
  on public.menu_items for all using (auth.uid() = user_id);

-- ── Baking Tasks ──────────────────────────────────────────────
create table if not exists public.baking_tasks (
  id           uuid primary key,
  user_id      uuid references auth.users on delete cascade not null,
  order_id     uuid references public.orders on delete set null,
  recipe_id    uuid references public.recipes on delete set null,
  title        text not null,
  due_date     timestamptz not null,
  is_completed bool not null default false,
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.baking_tasks enable row level security;
create policy "Users manage own baking tasks"
  on public.baking_tasks for all using (auth.uid() = user_id);

-- ── Ingredient Densities ──────────────────────────────────────
create table if not exists public.ingredient_densities (
  id            uuid primary key,
  user_id       uuid references auth.users on delete cascade not null,
  name          text not null,
  grams_per_cup double precision not null,
  is_custom     bool not null default true,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
alter table public.ingredient_densities enable row level security;
create policy "Users manage own densities"
  on public.ingredient_densities for all using (auth.uid() = user_id);

-- ── Profiles ──────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  user_name     text not null default '',
  business_name text not null default '',
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users manage own profile"
  on public.profiles for all using (auth.uid() = id);
