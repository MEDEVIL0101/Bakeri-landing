-- Growth Partner link-in-bio pages (Harvey 2026-11-11). A partner can turn on
-- a Bakerï page with their links and their partner code, built in the same
-- storefront builder as vendors but links-only. It's a profiles row flagged
-- is_partner_page, so the public /<slug> page renders it like any storefront,
-- while the web app, Admin and the CRM don't treat it as a shop.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_partner_page BOOLEAN NOT NULL DEFAULT FALSE;

-- Creates the page (once) and returns its slug. Selling cards start hidden;
-- the builder's links-only mode never shows them.
CREATE OR REPLACE FUNCTION public.partner_create_link_page(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_gp   public.growth_partners%ROWTYPE;
    v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
    v_existing public.profiles%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF NOT public.is_active_growth_partner(v_uid) THEN
        RAISE EXCEPTION 'Your partnership isn''t active.' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_gp FROM public.growth_partners WHERE user_id = v_uid;

    SELECT * INTO v_existing FROM public.profiles WHERE id = v_uid;
    IF FOUND THEN
        IF v_existing.is_partner_page THEN RETURN v_existing.profile_slug; END IF;
        RAISE EXCEPTION 'You already have a Bakerï shop. Add your partner code to it with the Bakerï Referral section.' USING ERRCODE = 'P0001';
    END IF;

    IF v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$' THEN
        RAISE EXCEPTION 'Use 3–40 letters, numbers or dashes, starting and ending with a letter or number.' USING ERRCODE = 'P0001';
    END IF;
    IF public.is_reserved_slug(v_slug) OR EXISTS (SELECT 1 FROM public.profiles WHERE profile_slug = v_slug) THEN
        RAISE EXCEPTION 'bakeriapp.com/% is taken. Try another.', v_slug USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.profiles (
        id, user_name, business_name, profile_slug, profile_slug_is_custom, is_partner_page,
        country, selected_theme, background_pattern, storefront_design, updated_at
    ) VALUES (
        v_uid, v_gp.name, coalesce(nullif(btrim(v_gp.company), ''), v_gp.name), v_slug, TRUE, TRUE,
        v_gp.country, 'Classic', 'Standard',
        jsonb_build_object('blocks', jsonb_build_array(
            jsonb_build_object('type', 'links', 'hidden', false),
            jsonb_build_object('type', 'referral', 'hidden', false),
            jsonb_build_object('type', 'about', 'hidden', true),
            jsonb_build_object('type', 'leadMagnet', 'hidden', true),
            jsonb_build_object('type', 'menu', 'hidden', true),
            jsonb_build_object('type', 'products', 'hidden', true),
            jsonb_build_object('type', 'courses', 'hidden', true),
            jsonb_build_object('type', 'clubs', 'hidden', true),
            jsonb_build_object('type', 'info', 'hidden', true),
            jsonb_build_object('type', 'emailCapture', 'hidden', true))),
        now()
    );
    RETURN v_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_create_link_page(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_create_link_page(TEXT) TO authenticated;

-- has_shop = a real shop; the link page is reported on its own.
CREATE OR REPLACE FUNCTION public.partner_me()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'user_id', gp.user_id, 'name', gp.name, 'email', gp.email, 'company', gp.company,
        'country', gp.country, 'status', gp.status,
        'payouts_ready', gp.stripe_connect_onboarding_complete AND gp.stripe_connect_account_id IS NOT NULL,
        'has_payout_account', gp.stripe_connect_account_id IS NOT NULL,
        'agreed_guidelines_at', gp.agreed_guidelines_at,
        'code', c.code,
        'commission_rate', COALESCE(c.commission_rate, 0.20),
        'commission_months', c.commission_months,
        'has_shop', EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = gp.user_id AND p.business_name IS NOT NULL AND NOT p.is_partner_page),
        'link_page_slug', (SELECT p.profile_slug FROM public.profiles p WHERE p.id = gp.user_id AND p.is_partner_page),
        'created_at', gp.created_at)
    FROM public.growth_partners gp
    LEFT JOIN public.referral_codes c ON c.user_id = gp.user_id
    WHERE gp.user_id = auth.uid();
$function$;

-- CRM: partners aren't prospects.
CREATE OR REPLACE FUNCTION public.crm_sync_prospects()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
     and not exists (select 1 from user_presence up where up.user_id = u.id)
     -- Growth Partners aren't prospects (they have their own screen in Admin).
     and not exists (select 1 from growth_partners gp where gp.user_id = u.id);

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
end $function$;

DELETE FROM public.crm_prospects cp
 WHERE cp.sources = ARRAY['account_no_app']
   AND EXISTS (SELECT 1 FROM public.growth_partners gp WHERE gp.user_id = cp.user_id);
