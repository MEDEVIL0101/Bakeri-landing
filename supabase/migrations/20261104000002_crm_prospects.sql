-- CRM pipeline for Bakeri Admin (Harvey 2026-11-04).
--
-- Everyone who showed interest but isn't using the iPhone app yet — vendor
-- applicants, beta invitees (many on Android, so they couldn't install the iOS
-- app), invite / 60-day / waitlist / artisan sign-ups, and accounts that never
-- opened the app — in one pipeline Harvey and Diana work through together:
--   new → contacted → replied → onboarding → won   (or lost)
--
-- crm_sync_prospects() pulls them in from the source tables and is safe to run
-- any time: it only adds people, fills blanks and moves someone forward when
-- they create an account (onboarding) or open the iPhone app (won). Stages set
-- by hand are otherwise left alone.
--
-- Admin-only: RLS on with no policies, so only the service role (Bakeri Admin)
-- can read or write.

create table if not exists public.crm_prospects (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name              text,
  business_name     text,
  phone             text,
  city              text,
  region            text,
  instagram_url     text,
  sources           text[] not null default '{}',
  user_id           uuid references auth.users(id) on delete set null,
  stage             text not null default 'new'
                    check (stage in ('new','contacted','replied','onboarding','won','lost')),
  platform          text not null default 'unknown'
                    check (platform in ('unknown','ios','android')),
  owner             text check (owner in ('harvey','diana')),
  next_step         text,
  next_step_on      date,
  notes             text,
  lost_reason       text,
  first_seen_at     timestamptz,
  last_contacted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists crm_prospects_email_key on public.crm_prospects (lower(email));
create index if not exists crm_prospects_stage_idx on public.crm_prospects (stage);

create table if not exists public.crm_activities (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.crm_prospects(id) on delete cascade,
  kind         text not null check (kind in ('email','note','stage','call')),
  subject      text,
  body         text,
  author       text not null default 'system',
  created_at   timestamptz not null default now()
);

create index if not exists crm_activities_prospect_idx on public.crm_activities (prospect_id, created_at desc);

alter table public.crm_prospects  enable row level security;
alter table public.crm_activities enable row level security;
revoke all on public.crm_prospects, public.crm_activities from anon, authenticated;
grant all on public.crm_prospects, public.crm_activities to service_role;

create or replace function public.crm_prospects_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists crm_prospects_touch on public.crm_prospects;
create trigger crm_prospects_touch before update on public.crm_prospects
  for each row execute function public.crm_prospects_touch();

create or replace function public.crm_sync_prospects() returns json
language plpgsql security definer set search_path = public, auth as $$
declare
  v_inserted int := 0;
  v_onboarding int := 0;
  v_won int := 0;
begin
  -- Every interested email, one row per source.
  drop table if exists _crm_src;
  create temporary table _crm_src on commit drop as
  select lower(trim(email)) as email, name, null::text as business_name, null::text as phone,
         null::text as city, null::text as region, null::text as instagram_url,
         'beta_invite'::text as source, created_at as seen_at, sent_at as contacted_at
    from (select email, name, sent_at, sent_at as created_at from beta_invites_sent) b
  union all
  select lower(trim(email)), name, null, null, null, null, null, 'beta_reminder', sent_at, sent_at
    from beta_reminders_sent
  union all
  select lower(trim(email)), nullif(trim(concat_ws(' ', first_name, last_name)), ''), bakery_name, phone,
         city, state_province, instagram_url, 'vendor_application', created_at,
         case when status = 'contacted' then created_at end
    from vendor_applications
  union all
  select lower(trim(email)), name, null, null, null, null, null, 'invite_application', created_at, null
    from invite_applications
  union all
  select lower(trim(email)), name, null, null, null, null, null, 'invite_application_60day', created_at, null
    from invite_applications_60day
  union all
  select lower(trim(email)), name, null, null, null, null, null, 'waitlist', created_at, null
    from waitlist
  union all
  select lower(trim(email)), name, null, null, null, null, handle, 'artisan_application', created_at, null
    from artisan_applications
  union all
  -- Accounts that never opened the iPhone app.
  select lower(u.email), coalesce(p.user_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
         p.business_name, null, p.pickup_city, p.pickup_province, null, 'account_no_app', u.created_at, null
    from auth.users u
    left join profiles p on p.id = u.id
   where u.email is not null
     and not exists (select 1 from user_presence up where up.user_id = u.id);

  delete from _crm_src
   where email is null or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      or email like '%@bakeriapp.com' or email = 'thebakeriapp@gmail.com';

  -- New people: everyone not already using the iPhone app.
  with agg as (
    select s.email,
           (array_agg(s.name order by s.name is null, s.seen_at))[1]          as name,
           (array_agg(s.business_name order by s.business_name is null))[1]   as business_name,
           (array_agg(s.phone order by s.phone is null))[1]                   as phone,
           (array_agg(s.city order by s.city is null))[1]                     as city,
           (array_agg(s.region order by s.region is null))[1]                 as region,
           (array_agg(s.instagram_url order by s.instagram_url is null))[1]   as instagram_url,
           array_agg(distinct s.source order by s.source)                     as sources,
           min(s.seen_at)                                                     as first_seen_at,
           max(s.contacted_at)                                                as last_contacted_at,
           bool_or(s.source in ('beta_invite','beta_reminder')
                   or (s.source = 'vendor_application' and s.contacted_at is not null)) as was_contacted
      from _crm_src s
     group by s.email
  ), acct as (
    select lower(email) as email, id from auth.users where email is not null
  ), ins as (
    insert into crm_prospects (email, name, business_name, phone, city, region, instagram_url,
                               sources, user_id, stage, first_seen_at, last_contacted_at)
    select a.email, a.name, a.business_name, a.phone, a.city, a.region, a.instagram_url,
           a.sources, acct.id,
           case when acct.id is not null then 'onboarding'
                when a.was_contacted then 'contacted'
                else 'new' end,
           a.first_seen_at, a.last_contacted_at
      from agg a
      left join acct on acct.email = a.email
     where not exists (select 1 from crm_prospects cp where lower(cp.email) = a.email)
       and not exists (select 1 from user_presence up where up.user_id = acct.id)
    returning 1
  )
  select count(*) into v_inserted from ins;

  -- Existing people: merge sources and fill blanks, never overwrite.
  update crm_prospects cp set
    sources       = (select array_agg(distinct x order by x) from unnest(cp.sources || a.sources) x),
    name          = coalesce(cp.name, a.name),
    business_name = coalesce(cp.business_name, a.business_name),
    phone         = coalesce(cp.phone, a.phone),
    city          = coalesce(cp.city, a.city),
    region        = coalesce(cp.region, a.region),
    instagram_url = coalesce(cp.instagram_url, a.instagram_url),
    first_seen_at = least(cp.first_seen_at, a.first_seen_at)
  from (select email, array_agg(distinct source) sources, min(seen_at) first_seen_at,
               (array_agg(name order by name is null))[1] name,
               (array_agg(business_name order by business_name is null))[1] business_name,
               (array_agg(phone order by phone is null))[1] phone,
               (array_agg(city order by city is null))[1] city,
               (array_agg(region order by region is null))[1] region,
               (array_agg(instagram_url order by instagram_url is null))[1] instagram_url
          from _crm_src group by email) a
  where lower(cp.email) = a.email
    and not (cp.sources @> a.sources and cp.name is not distinct from coalesce(cp.name, a.name)
             and cp.business_name is not distinct from coalesce(cp.business_name, a.business_name)
             and cp.phone is not distinct from coalesce(cp.phone, a.phone)
             and cp.city is not distinct from coalesce(cp.city, a.city)
             and cp.region is not distinct from coalesce(cp.region, a.region)
             and cp.instagram_url is not distinct from coalesce(cp.instagram_url, a.instagram_url));

  -- Link accounts created since the last sync.
  update crm_prospects cp set user_id = u.id
    from auth.users u
   where cp.user_id is null and lower(u.email) = lower(cp.email);

  -- Created an account → onboarding.
  with moved as (
    update crm_prospects cp set stage = 'onboarding'
     where cp.user_id is not null and cp.stage in ('new','contacted','replied')
    returning cp.id
  ), logged as (
    insert into crm_activities (prospect_id, kind, body)
    select id, 'stage', 'Created a Bakerï account → Onboarding' from moved
    returning 1
  )
  select count(*) into v_onboarding from logged;

  -- Opened the iPhone app → won.
  with moved as (
    update crm_prospects cp set stage = 'won', platform = 'ios'
     where cp.stage not in ('won','lost')
       and exists (select 1 from user_presence up where up.user_id = cp.user_id)
    returning cp.id
  ), logged as (
    insert into crm_activities (prospect_id, kind, body)
    select id, 'stage', 'Opened the iPhone app → Won' from moved
    returning 1
  )
  select count(*) into v_won from logged;

  return json_build_object('inserted', v_inserted, 'moved_to_onboarding', v_onboarding, 'moved_to_won', v_won);
end $$;

revoke all on function public.crm_sync_prospects() from public, anon, authenticated;
grant execute on function public.crm_sync_prospects() to service_role;

select public.crm_sync_prospects();
