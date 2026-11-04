-- Bakeri Admin "Intelligence" (Harvey 2026-11-04): one call that joins every
-- signal we hold about each vendor — orders and order value (this 30 days vs
-- the 30 before), listings, storefront visits, iPhone/web activity, Stripe,
-- plan, customers, referrals — plus a 26-week platform series. The admin app
-- scores vendor health, raises signals and forecasts from this.
-- Order value is summed from order_items, like admin_platform_summary_range.
-- Service role (Bakeri Admin) only.

create or replace function public.admin_intelligence() returns json
language sql stable security definer set search_path = public, auth as $$
  with o as (
    select o.id, o.user_id, o.created_at, o.is_paid,
           coalesce((select sum(oi.price_per_unit * oi.quantity) from order_items oi
                      where oi.order_id = o.id and oi.deleted_at is null), 0) as value
      from orders o
     where o.deleted_at is null
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
             where u.created_at >= w.wk and u.created_at < w.wk + interval '1 week') as new_vendors,
           (select count(*) from storefront_events e where e.event = 'page_view' and e.created_at >= w.wk and e.created_at < w.wk + interval '1 week') as visits
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

revoke all on function public.admin_intelligence() from public, anon, authenticated;
grant execute on function public.admin_intelligence() to service_role;
