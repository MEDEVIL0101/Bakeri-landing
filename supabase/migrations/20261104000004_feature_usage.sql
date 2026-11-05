-- Bakeri Admin "Usage" (Harvey 2026-11-04): who uses which parts of Bakerï.
--
-- 1. app_events — screen opens logged by the iPhone app and the web app from
--    now on. Signed-in users insert their own rows; nobody can read them back
--    except the service role (Bakeri Admin).
-- 2. admin_feature_usage() — per vendor, per feature: total uses, uses in the
--    last 30 days and last used. Derived from the rows each feature already
--    writes (orders, recipes, tasks, listings, links, campaigns…), so it
--    covers history, plus the screen opens from app_events.
-- Service role (Bakeri Admin) only.

create table if not exists public.app_events (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  screen      text not null check (char_length(screen) between 1 and 60),
  platform    text not null check (platform in ('ios', 'web')),
  app_version text check (char_length(app_version) <= 30),
  created_at  timestamptz not null default now()
);

create index if not exists app_events_user_created_idx on public.app_events (user_id, created_at desc);
create index if not exists app_events_screen_created_idx on public.app_events (screen, created_at desc);

alter table public.app_events enable row level security;

drop policy if exists "users log their own screen opens" on public.app_events;
create policy "users log their own screen opens" on public.app_events
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.app_events from anon;
revoke select, update, delete on public.app_events from authenticated;
grant insert on public.app_events to authenticated;
grant usage on sequence public.app_events_id_seq to authenticated;
grant all on public.app_events to service_role;
grant usage on sequence public.app_events_id_seq to service_role;

create or replace function public.admin_feature_usage() returns json
language sql stable security definer set search_path = public, auth as $$
  with uses (user_id, feature, at) as (
              select user_id, 'orders_manual', created_at from orders where deleted_at is null and order_source = 'manual'
    union all select user_id, 'orders_storefront', created_at from orders where deleted_at is null and order_source = 'marketplace'
    union all select user_id, 'quotes', created_at from orders where deleted_at is null and quoted_price is not null
    union all select user_id, 'deposits', created_at from orders where deleted_at is null and invoice_type in ('deposit', 'balance')
    union all select user_id, 'form_orders', created_at from orders where deleted_at is null and form_responses is not null
    union all select user_id, 'delivery', created_at from orders where deleted_at is null and (coalesce(is_delivery, false) or shipped_at is not null)
    union all select user_id, 'order_notes', updated_at from order_vendor_notes
    union all select user_id, 'listing_' || coalesce(nullif(listing_kind, ''), 'other'), created_at from menu_items where deleted_at is null
    union all select user_id, 'intake_forms', created_at from intake_forms
    union all select user_id, 'recipes', created_at from recipes
    union all select user_id, 'costing', created_at from ingredient_costs
    union all select user_id, 'packaging', created_at from packaging_items
    union all select user_id, 'schedule', created_at from baking_tasks
    union all select user_id, 'unavailable_dates', created_at from baker_unavailable_dates
    union all select user_id, 'links', created_at from baker_links
    union all select user_id, 'faqs', created_at from baker_faqs
    union all select user_id, 'contacts', created_at from baker_contacts
    union all select user_id, 'campaigns', created_at from baker_campaigns
    union all select user_id, 'promotions', created_at from promotions where deleted_at is null
    union all select author_id, 'community', created_at from community_threads
    union all select author_id, 'community', created_at from community_comments
    union all select user_id, 'community', created_at from community_likes
    union all select user_id, 'ai', created_at from ai_usage
    union all select referrer_user_id, 'referrals', created_at from referrals
  ),
  per as (
    select user_id, feature,
           count(*)                                                        as n,
           count(*) filter (where at >= now() - interval '30 days')       as n30,
           max(at)                                                         as last_at
      from uses where user_id is not null
     group by user_id, feature
  ),
  screens as (
    select user_id, screen, platform,
           count(*)                                                        as n,
           count(*) filter (where created_at >= now() - interval '30 days') as n30,
           max(created_at)                                                 as last_at
      from app_events
     group by user_id, screen, platform
  ),
  people as (
    select p.id,
           coalesce(nullif(p.business_name, ''), nullif(p.user_name, ''), u.email) as name,
           p.profile_slug as slug,
           u.email,
           u.created_at as joined_at,
           (select max(last_seen_at) from user_presence up where up.user_id = p.id) as last_app_at,
           (select max(app_version) from user_presence up where up.user_id = p.id)  as app_version,
           (select max(last_seen_at) from web_presence wp where wp.user_id = p.id)  as last_web_at
      from profiles p
      join auth.users u on u.id = p.id
     where u.email not ilike '%@bakeriapp.com' and u.email <> 'thebakeriapp@gmail.com'
  )
  select json_build_object(
    'generated_at', now(),
    'vendors', coalesce((select json_agg(json_build_object(
        'id', pe.id, 'name', pe.name, 'slug', pe.slug, 'email', pe.email, 'joined_at', pe.joined_at,
        'last_app_at', pe.last_app_at, 'app_version', pe.app_version, 'last_web_at', pe.last_web_at,
        'features', coalesce((select json_agg(json_build_object('key', f.feature, 'n', f.n, 'n30', f.n30, 'last_at', f.last_at))
                                from per f where f.user_id = pe.id), '[]'::json),
        'screens',  coalesce((select json_agg(json_build_object('key', s.screen, 'platform', s.platform, 'n', s.n, 'n30', s.n30, 'last_at', s.last_at))
                                from screens s where s.user_id = pe.id), '[]'::json)
      )) from people pe), '[]'::json),
    'daily_screens', coalesce((select json_agg(d order by d.day) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, platform,
               count(*) as opens, count(distinct user_id) as people
          from app_events where created_at >= now() - interval '30 days'
         group by 1, 2) d), '[]'::json)
  );
$$;

revoke all on function public.admin_feature_usage() from public, anon, authenticated;
grant execute on function public.admin_feature_usage() to service_role;
