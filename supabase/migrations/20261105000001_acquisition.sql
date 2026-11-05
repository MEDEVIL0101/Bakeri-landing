-- Bakeri Admin "Acquisition" + "Customer Picture" (Harvey 2026-11-04): a
-- customer-acquisition roadmap, an experiment log, customer interviews and
-- the written ICP, plus two read-only views of the data:
--   admin_customer_profiles()  — every vendor's behaviour, for segmenting
--                                customers into types and scoring ICP fit
--   admin_acquisition_weekly() — the weekly funnel from outreach to first
--                                checkout sale
-- Everything here is service role (Bakeri Admin) only.

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.acq_roadmap (
  id         uuid primary key default gen_random_uuid(),
  phase      text not null check (phase in ('learn', 'find', 'reach', 'convert', 'measure')),
  title      text not null,
  detail     text,
  metric     text,
  owner      text check (owner in ('harvey', 'diana')),
  status     text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  due_on     date,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acq_experiments (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  channel    text,
  hypothesis text,
  target     text,
  status     text not null default 'planned' check (status in ('planned', 'running', 'done', 'stopped')),
  started_on date,
  ended_on   date,
  result     text,
  learnings  text,
  owner      text check (owner in ('harvey', 'diana')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acq_interviews (
  id            uuid primary key default gen_random_uuid(),
  person        text not null,
  business      text,
  user_id       uuid references auth.users(id) on delete set null,
  held_on       date not null default current_date,
  customer_type text,
  before_tools  text,   -- what they used before Bakerï
  pains         text,
  found_us      text,
  hangouts      text,   -- where they learn and spend time online
  would_pay     text,
  quotes        text,
  notes         text,
  author        text check (author in ('harvey', 'diana')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Free-text documents edited in the admin (the written ICP).
create table if not exists public.acq_notes (
  key        text primary key,
  body       text not null default '',
  updated_by text check (updated_by in ('harvey', 'diana')),
  updated_at timestamptz not null default now()
);

create or replace function public.acq_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['acq_roadmap', 'acq_experiments', 'acq_interviews', 'acq_notes'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.acq_touch_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ── Starting roadmap (editable in the admin) ──────────────────────────────

insert into public.acq_roadmap (phase, title, detail, metric, due_on, sort)
select * from (values
  ('learn',   'Interview Cookies by Steph',
              'How she found Bakerï, what she used before, who she follows and learns from, which groups she is in, who else sells like her.',
              'Interview logged', current_date + 3, 10),
  ('learn',   'Interview Designer Cakes by Karissa',
              'Same questions, plus why she joined when Steph told her, and what nearly stopped her.',
              'Interview logged', current_date + 4, 20),
  ('learn',   'Talk to the two who stopped (Tina, simplyrayxi)',
              'Not to sell. Ask what they expected and what made them stop.',
              'Reasons logged', current_date + 5, 30),
  ('learn',   'Write ICP v1',
              'In Customer Picture: who they are, what they sell, where they are found, what triggers them, who is not a fit.',
              'ICP written', current_date + 7, 40),
  ('find',    'List 50 Steph-like creators',
              'Steph''s and Karissa''s networks (who they follow, tag, collaborate with), Instagram "Suggested for you", hashtags like #cookiedrop and #preordersopen, bios with "DM to order" or "order form in bio".',
              '50 creators in the Pipeline', current_date + 10, 50),
  ('find',    'Join 3 maker communities',
              'Facebook groups, Reddit, Discord for cookie and cake decorators and cottage bakers. Be useful there before mentioning Bakerï.',
              '3 communities joined', current_date + 10, 60),
  ('reach',   'Test two DM scripts',
              'Log each as an experiment. Personal, short, no pitch in the first message.',
              'Reply rate per script', current_date + 14, 70),
  ('reach',   '10 personal DMs a day each',
              'From the creator list. Log every one in the Pipeline.',
              '100+ contacted', current_date + 21, 80),
  ('reach',   'Holiday pre-order push',
              'November and December are when pre-orders by DM and form hurt most. "Take your holiday pre-orders through Bakerï."',
              'Sign-ups from the campaign', current_date + 30, 90),
  ('convert', 'Offer a setup call to every reply',
              'Set up their shop with them. Doing it for them is what converts early on.',
              'Calls booked', current_date + 21, 100),
  ('convert', 'Follow up every new sign-up within 24 hours',
              'Personal email from Harvey or Diana to everyone who signs up.',
              'All sign-ups contacted', current_date + 7, 110),
  ('convert', 'First checkout sale within 14 days',
              'Help each new vendor get their first order paid through Bakerï checkout.',
              'Vendors with a first checkout sale', current_date + 30, 120),
  ('measure', 'Weekly review every Monday',
              'Acquisition funnel, experiments, Pipeline. Decide what to do more of and what to stop.',
              'Review held', current_date + 7, 130),
  ('measure', 'Pick the channels to double down on',
              'After about three weeks and a few hundred visitors, judge channels on paying customers, not clicks.',
              'Decision written', current_date + 21, 140),
  ('measure', 'Rethink the referral reward',
              'A share of fees lets a referrer work out the other vendor''s sales. Consider a flat reward or a free month for both.',
              'Decision made', current_date + 14, 150)
) as v(phase, title, detail, metric, due_on, sort)
where not exists (select 1 from public.acq_roadmap);

insert into public.acq_experiments (title, channel, hypothesis, target, status, started_on, result)
select 'Referral links posted by Steph and Karissa', 'Referral',
       'Creators posting their referral link to followers brings in other makers.',
       '3 sign-ups in 2 weeks', 'running', date '2026-11-02',
       'So far: Steph''s link 10 visitors, 1 sign-up (Tina, stopped before setup). Karissa''s link 0 visitors. Followers are mostly buyers, not makers.'
where not exists (select 1 from public.acq_experiments);

insert into public.acq_notes (key, body) values ('icp', '')
on conflict (key) do nothing;

-- ── Customer profiles ─────────────────────────────────────────────────────

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
  where u.email not ilike '%@bakeriapp.com' and u.email <> 'thebakeriapp@gmail.com';
$$;

-- ── Weekly acquisition funnel ─────────────────────────────────────────────

create or replace function public.admin_acquisition_weekly(p_weeks integer default 12) returns json
language sql stable security definer set search_path = public, auth as $$
  with weeks as (
    select generate_series(date_trunc('week', now()) - make_interval(weeks => greatest(p_weeks, 1) - 1),
                           date_trunc('week', now()), interval '1 week') as wk
  ),
  site as (select * from site_events where path not like '/app/%' or event <> 'page_view'),
  creators as (select id, created_at from crm_prospects where fit <> 'tools'),
  first_checkout as (
    select user_id, min(created_at) as at from orders
     where deleted_at is null and (payment_intent_id is not null or deposit_payment_intent_id is not null)
     group by user_id
  ),
  real_users as (
    select id, created_at from auth.users
     where email not ilike '%@bakeriapp.com' and email <> 'thebakeriapp@gmail.com'
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
    'trials', (select count(*) from vendor_plans v where v.trial_used_at >= w.wk and v.trial_used_at < w.wk + interval '1 week'),
    'paid', (select count(*) from vendor_plans v where v.first_paid_at >= w.wk and v.first_paid_at < w.wk + interval '1 week'),
    'first_checkout_sales', (select count(*) from first_checkout f where f.at >= w.wk and f.at < w.wk + interval '1 week')
  ) order by w.wk), '[]'::json)
  from weeks w;
$$;

revoke all on function public.admin_customer_profiles() from public, anon, authenticated;
grant execute on function public.admin_customer_profiles() to service_role;
revoke all on function public.admin_acquisition_weekly(integer) from public, anon, authenticated;
grant execute on function public.admin_acquisition_weekly(integer) to service_role;
