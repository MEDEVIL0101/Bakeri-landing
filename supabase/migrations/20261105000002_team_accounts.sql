-- Team accounts (Harvey 2026-11-05): Bakerï's own accounts (Harvey's Sweet
-- Southern Bakery, Diana's Tilly Sugar Cookies, test shops) were counted as
-- customers, so the admin flagged Sweet Southern as a vendor going quiet and
-- their test orders inflated every total. Team accounts move from this Mac's
-- UserDefaults into admin_team_accounts (shared, so Diana's admin agrees),
-- and every admin analytics function leaves them out: Intelligence, Usage,
-- Customer Picture, Acquisition, and the Command Centre / Analytics totals.
-- The Users list still shows them, marked as team.

create table if not exists public.admin_team_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  marked_by  text,
  created_at timestamptz not null default now()
);
alter table public.admin_team_accounts enable row level security;
revoke all on public.admin_team_accounts from anon, authenticated;
grant all on public.admin_team_accounts to service_role;

-- The nine accounts already marked as team in the admin app.
insert into public.admin_team_accounts (user_id, marked_by)
select id, 'harvey' from auth.users where id in (
  '8b1c5ac0-982f-4d2a-973a-576201fe81c5',
  'c86c374e-92bd-4b89-885a-838759ec32c1',
  'db3ce8d4-9f8a-420b-8a89-7d781ac98162',
  '238e00cd-6b32-456d-86b1-8db390f4dcfc',
  '9cca2737-16f8-47dd-8b9f-c4e089aaf394',
  'fba66510-1335-4ade-80c1-1d990a43a75f',
  '83d23272-cc95-4225-b9de-72ec55e678a8',
  '355e30bc-7bd1-423d-a38c-8bff26106de2',
  'd75d4f75-a9be-4706-8511-9077dcc02355')
on conflict (user_id) do nothing;

create or replace function public.admin_intelligence() returns json
language sql stable security definer set search_path = public, auth as $$
  with o as (
    select o.id, o.user_id, o.created_at, o.is_paid,
           coalesce((select sum(oi.price_per_unit * oi.quantity) from order_items oi
                      where oi.order_id = o.id and oi.deleted_at is null), 0) as value
      from orders o
     where o.deleted_at is null
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
  ),
  per_vendor as (
    select user_id,
           count(*)                                                             as orders_total,
           count(*) filter (where created_at >= now() - interval '30 days')     as orders_30,
           count(*) filter (where created_at >= now() - interval '60 days'
                              and created_at <  now() - interval '30 days')     as orders_prev30,
           sum(value)                                                           as gtv_total,
           coalesce(sum(value) filter (where created_at >= now() - interval '30 days'), 0) as gtv_30,
           coalesce(sum(value) filter (where created_at >= now() - interval '60 days'
                                         and created_at <  now() - interval '30 days'), 0) as gtv_prev30,
           max(created_at)                                                      as last_order_at,
           min(created_at)                                                      as first_order_at
      from o group by user_id
  ),
  visits as (
    select shop_id,
           count(*) filter (where event = 'page_view' and created_at >= now() - interval '30 days') as visits_30,
           count(*) filter (where event = 'page_view' and created_at >= now() - interval '60 days'
                              and created_at <  now() - interval '30 days')                       as visits_prev30,
           count(*) filter (where event = 'add_to_cart' and created_at >= now() - interval '30 days') as carts_30
      from storefront_events
     where not exists (select 1 from public.admin_team_accounts t where t.user_id = shop_id)
     group by shop_id
  ),
  vendors as (
    select p.id,
           coalesce(nullif(p.business_name, ''), nullif(p.user_name, ''), u.email) as name,
           p.profile_slug as slug,
           u.email,
           u.created_at                                         as joined_at,
           coalesce(pv.orders_total, 0)                         as orders_total,
           coalesce(pv.orders_30, 0)                            as orders_30,
           coalesce(pv.orders_prev30, 0)                        as orders_prev30,
           coalesce(pv.gtv_total, 0)                            as gtv_total,
           coalesce(pv.gtv_30, 0)                               as gtv_30,
           coalesce(pv.gtv_prev30, 0)                           as gtv_prev30,
           pv.last_order_at,
           pv.first_order_at,
           (select count(*) from menu_items m
             where m.user_id = p.id and m.deleted_at is null and coalesce(m.is_active, true)) as active_listings,
           coalesce(v.visits_30, 0)                             as visits_30,
           coalesce(v.visits_prev30, 0)                         as visits_prev30,
           coalesce(v.carts_30, 0)                              as carts_30,
           (select max(last_seen_at) from user_presence up where up.user_id = p.id) as last_app_at,
           (select max(last_seen_at) from web_presence wp where wp.user_id = p.id)  as last_web_at,
           coalesce(p.stripe_connect_onboarding_complete, false) as stripe_ready,
           vp.tier                                              as plan_tier,
           vp.status                                            as plan_status,
           coalesce(vp.grandfathered_starter, false)            as grandfathered,
           (select count(*) from baker_contacts bc where bc.user_id = p.id) as customers,
           (select count(*) from referrals r where r.referrer_user_id = p.id) as referrals_made
      from profiles p
      join auth.users u on u.id = p.id
      left join per_vendor pv on pv.user_id = p.id
      left join visits v on v.shop_id = p.id
      left join vendor_plans vp on vp.user_id = p.id
     where not exists (select 1 from public.admin_team_accounts t where t.user_id = p.id)
  ),
  weeks as (
    select generate_series(date_trunc('week', now()) - interval '25 weeks', date_trunc('week', now()), interval '1 week') as wk
  ),
  series as (
    select w.wk,
           (select count(*) from o where o.created_at >= w.wk and o.created_at < w.wk + interval '1 week') as orders,
           (select coalesce(sum(value), 0) from o where o.created_at >= w.wk and o.created_at < w.wk + interval '1 week') as gtv,
           (select count(distinct user_id) from o where o.created_at >= w.wk and o.created_at < w.wk + interval '1 week') as active_vendors,
           (select count(*) from profiles p join auth.users u on u.id = p.id
             where u.created_at >= w.wk and u.created_at < w.wk + interval '1 week'
               and not exists (select 1 from public.admin_team_accounts t where t.user_id = p.id)) as new_vendors,
           (select count(*) from storefront_events e where e.event = 'page_view' and e.created_at >= w.wk and e.created_at < w.wk + interval '1 week'
               and not exists (select 1 from public.admin_team_accounts t where t.user_id = e.shop_id)) as visits
      from weeks w
  )
  select json_build_object(
    'generated_at', now(),
    'vendors', coalesce((select json_agg(v order by v.gtv_30 desc, v.orders_total desc) from vendors v), '[]'::json),
    'weekly',  coalesce((select json_agg(json_build_object(
                  'week', to_char(s.wk, 'YYYY-MM-DD'), 'orders', s.orders, 'gtv', s.gtv,
                  'active_vendors', s.active_vendors, 'new_vendors', s.new_vendors, 'visits', s.visits)
                  order by s.wk) from series s), '[]'::json)
  );
$$;

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
     where not exists (select 1 from public.admin_team_accounts t where t.user_id = app_events.user_id)
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
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = p.id)
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
          from app_events where created_at >= now() - interval '30 days' and not exists (select 1 from public.admin_team_accounts t where t.user_id = app_events.user_id)
         group by 1, 2) d), '[]'::json)
  );
$$;

create or replace function public.admin_customer_profiles() returns json
language sql stable security definer set search_path = public, auth as $$
  with o as (
    select o.user_id, o.created_at, o.customer_email, o.quoted_price, o.invoice_type, o.form_responses,
           (o.payment_intent_id is not null or o.deposit_payment_intent_id is not null) as via_checkout,
           coalesce((select sum(oi.price_per_unit * oi.quantity) from order_items oi
                      where oi.order_id = o.id and oi.deleted_at is null), 0) as value
      from orders o
     where o.deleted_at is null
  ),
  ov as (
    select user_id,
           count(*)                                                          as orders_total,
           count(*) filter (where created_at >= now() - interval '90 days')  as orders_90,
           sum(value)                                                        as value_total,
           coalesce(sum(value) filter (where via_checkout), 0)               as value_checkout,
           coalesce(sum(value) filter (where created_at >= now() - interval '90 days'), 0) as value_90,
           count(*) filter (where quoted_price is not null)                  as quotes,
           count(*) filter (where invoice_type in ('deposit', 'balance'))    as deposits,
           count(*) filter (where form_responses is not null)                as form_orders,
           count(distinct date_trunc('month', created_at))                   as active_months,
           min(created_at)                                                   as first_order_at,
           max(created_at)                                                   as last_order_at,
           (select count(*) from (select lower(o2.customer_email) from o o2
                                   where o2.user_id = o.user_id and coalesce(o2.customer_email, '') <> ''
                                   group by 1 having count(*) > 1) r)         as repeat_buyers,
           count(distinct lower(nullif(customer_email, '')))                 as buyers
      from o group by user_id
  ),
  lv as (
    select user_id,
           count(*) filter (where listing_kind = 'digital')   as l_digital,
           count(*) filter (where listing_kind = 'custom')    as l_custom,
           count(*) filter (where listing_kind = 'ready_now') as l_ready_now,
           count(*) filter (where listing_kind = 'preorder')  as l_preorder,
           count(*) filter (where listing_kind = 'physical')  as l_physical
      from menu_items
     where deleted_at is null and coalesce(is_active, true)
     group by user_id
  ),
  sv as (
    select shop_id,
           count(*) filter (where event = 'page_view')                                          as visits_total,
           count(*) filter (where event = 'page_view' and created_at >= now() - interval '90 days') as visits_90,
           count(*) filter (where event = 'page_view' and source in ('instagram', 'ig'))        as v_instagram,
           count(*) filter (where event = 'page_view' and source = 'tiktok')                    as v_tiktok,
           count(*) filter (where event = 'page_view' and source = 'facebook')                  as v_facebook,
           count(*) filter (where event = 'page_view' and source = 'direct')                    as v_direct
      from storefront_events group by shop_id
  )
  select coalesce(json_agg(json_build_object(
    'id', p.id,
    'name', coalesce(nullif(p.business_name, ''), nullif(p.user_name, ''), u.email),
    'slug', p.profile_slug,
    'email', u.email,
    'joined_at', u.created_at,
    'city', coalesce(nullif(p.pickup_city, ''), nullif(p.location, '')),
    'region', nullif(p.pickup_province, ''),
    'country', p.country,
    'setup_done', p.vendor_setup_completed_at is not null or coalesce(p.business_name, '') <> '',
    'stripe_ready', coalesce(p.stripe_connect_onboarding_complete, false),
    'plan_tier', vp.tier, 'plan_status', vp.status,
    'grandfathered', coalesce(vp.grandfathered_starter, false),
    'orders_total', coalesce(ov.orders_total, 0), 'orders_90', coalesce(ov.orders_90, 0),
    'value_total', coalesce(ov.value_total, 0), 'value_checkout', coalesce(ov.value_checkout, 0),
    'value_90', coalesce(ov.value_90, 0),
    'quotes', coalesce(ov.quotes, 0), 'deposits', coalesce(ov.deposits, 0), 'form_orders', coalesce(ov.form_orders, 0),
    'active_months', coalesce(ov.active_months, 0),
    'first_order_at', ov.first_order_at, 'last_order_at', ov.last_order_at,
    'buyers', coalesce(ov.buyers, 0), 'repeat_buyers', coalesce(ov.repeat_buyers, 0),
    'l_digital', coalesce(lv.l_digital, 0), 'l_custom', coalesce(lv.l_custom, 0),
    'l_ready_now', coalesce(lv.l_ready_now, 0), 'l_preorder', coalesce(lv.l_preorder, 0),
    'l_physical', coalesce(lv.l_physical, 0),
    'visits_total', coalesce(sv.visits_total, 0), 'visits_90', coalesce(sv.visits_90, 0),
    'v_instagram', coalesce(sv.v_instagram, 0), 'v_tiktok', coalesce(sv.v_tiktok, 0),
    'v_facebook', coalesce(sv.v_facebook, 0), 'v_direct', coalesce(sv.v_direct, 0),
    'last_app_at', (select max(last_seen_at) from user_presence up where up.user_id = p.id),
    'last_web_at', (select max(last_seen_at) from web_presence wp where wp.user_id = p.id),
    'referred_by', (select coalesce(nullif(rp.business_name, ''), rp.user_name) from referrals r
                      join profiles rp on rp.id = r.referrer_user_id where r.referred_baker_id = p.id limit 1),
    'crm_referred_by', (select c.referred_by from crm_prospects c where c.user_id = p.id limit 1)
  ) order by coalesce(ov.value_total, 0) desc), '[]'::json)
  from profiles p
  join auth.users u on u.id = p.id
  left join ov on ov.user_id = p.id
  left join lv on lv.user_id = p.id
  left join sv on sv.shop_id = p.id
  left join vendor_plans vp on vp.user_id = p.id
  where u.email not ilike '%@bakeriapp.com' and u.email <> 'thebakeriapp@gmail.com'
    and not exists (select 1 from public.admin_team_accounts t where t.user_id = p.id);
$$;

create or replace function public.admin_acquisition_weekly(p_weeks integer default 12) returns json
language sql stable security definer set search_path = public, auth as $$
  with weeks as (
    select generate_series(date_trunc('week', now()) - make_interval(weeks => greatest(p_weeks, 1) - 1),
                           date_trunc('week', now()), interval '1 week') as wk
  ),
  site as (select * from site_events where path not like '/app/%' or event <> 'page_view'),
  creators as (select id, created_at from crm_prospects c where fit <> 'tools' and (c.user_id is null or not exists (select 1 from public.admin_team_accounts t where t.user_id = c.user_id))),
  first_checkout as (
    select user_id, min(created_at) as at from orders
     where deleted_at is null and (payment_intent_id is not null or deposit_payment_intent_id is not null)
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = orders.user_id)
     group by user_id
  ),
  real_users as (
    select id, created_at from auth.users
     where email not ilike '%@bakeriapp.com' and email <> 'thebakeriapp@gmail.com'
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = auth.users.id)
  )
  select coalesce(json_agg(json_build_object(
    'week', to_char(w.wk, 'YYYY-MM-DD'),
    'creators_added', (select count(*) from creators c where c.created_at >= w.wk and c.created_at < w.wk + interval '1 week'),
    'contacted', (select count(distinct a.prospect_id) from crm_activities a join creators c on c.id = a.prospect_id
                   where a.kind = 'email' and a.created_at >= w.wk and a.created_at < w.wk + interval '1 week'),
    'replied', (select count(distinct a.prospect_id) from crm_activities a join creators c on c.id = a.prospect_id
                 where a.kind = 'stage' and a.body like '%→ Replied%' and a.created_at >= w.wk and a.created_at < w.wk + interval '1 week'),
    'site_visitors', (select count(distinct visitor) from site s where s.event = 'page_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'signup_views', (select count(distinct visitor) from site s where s.event = 'signup_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'signups', (select count(*) from real_users u where u.created_at >= w.wk and u.created_at < w.wk + interval '1 week'),
    'plan_views', (select count(distinct visitor) from site s where s.event = 'plan_view' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'checkout_starts', (select count(distinct visitor) from site s where s.event = 'checkout_start' and s.created_at >= w.wk and s.created_at < w.wk + interval '1 week'),
    'trials', (select count(*) from vendor_plans v where v.trial_used_at >= w.wk and v.trial_used_at < w.wk + interval '1 week' and not exists (select 1 from public.admin_team_accounts t where t.user_id = v.user_id)),
    'paid', (select count(*) from vendor_plans v where v.first_paid_at >= w.wk and v.first_paid_at < w.wk + interval '1 week' and not exists (select 1 from public.admin_team_accounts t where t.user_id = v.user_id)),
    'first_checkout_sales', (select count(*) from first_checkout f where f.at >= w.wk and f.at < w.wk + interval '1 week')
  ) order by w.wk), '[]'::json)
  from weeks w;
$$;

create or replace function public.admin_daily_order_metrics(p_days integer default 30)
 returns table(day date, order_count bigint, daily_gtv numeric)
 language sql security definer set search_path to 'public'
as $$
    select date(o.created_at at time zone 'UTC')               as day,
           count(distinct o.id)                                 as order_count,
           coalesce(sum(oi.price_per_unit * oi.quantity), 0)   as daily_gtv
      from orders o
      left join order_items oi on oi.order_id = o.id and oi.deleted_at is null
     where o.deleted_at is null
       and o.created_at >= (now() at time zone 'UTC') - (p_days || ' days')::interval
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
     group by date(o.created_at at time zone 'UTC')
     order by day;
$$;

create or replace function public.admin_platform_summary()
 returns table(baker_user_id uuid, order_count bigint, total_gtv numeric, paid_gtv numeric)
 language sql security definer set search_path to 'public'
as $$
    select o.user_id, count(distinct o.id),
           coalesce(sum(oi.price_per_unit * oi.quantity), 0),
           coalesce(sum(case when o.is_paid = true then oi.price_per_unit * oi.quantity else 0 end), 0)
      from orders o
      left join order_items oi on oi.order_id = o.id and oi.deleted_at is null
     where o.deleted_at is null
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
     group by o.user_id;
$$;

create or replace function public.admin_platform_summary_range(p_from timestamptz default null, p_to timestamptz default null)
 returns table(baker_user_id uuid, order_count bigint, total_gtv numeric, paid_gtv numeric)
 language sql stable security definer set search_path to 'public'
as $$
    select o.user_id, count(distinct o.id),
           coalesce(sum(oi.price_per_unit * oi.quantity), 0),
           coalesce(sum(case when o.is_paid = true then oi.price_per_unit * oi.quantity else 0 end), 0)
      from orders o
      left join order_items oi on oi.order_id = o.id and oi.deleted_at is null
     where o.deleted_at is null
       and (p_from is null or o.created_at >= p_from)
       and (p_to   is null or o.created_at <  p_to)
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
     group by o.user_id;
$$;
