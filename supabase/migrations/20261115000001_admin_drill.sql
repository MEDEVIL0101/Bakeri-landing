-- Bakeri Admin: every number can be investigated (Harvey 2026-11-15).
-- admin_drill(metric, from, to, key) returns the rows behind a number shown in
-- the Admin app: the people who signed up, the orders that make up a GTV, the
-- visitors behind a traffic figure… A screen's number and its drill-down are
-- the same query, so the count of rows (or the sum of their values) is the
-- number that was clicked.
--
-- Each row: { id, user_id?, order_id?, title, subtitle, value?, display?, at? }
--   value   — the row's share of the number (an order's value, a visitor's views)
--   display — preformatted value when it isn't a plain count or amount
--
-- Team accounts (admin_team_accounts) and internal addresses are left out
-- everywhere, as on the screens. Service role only.
--
-- Also here:
--   • admin_daily_order_metrics takes a time zone, so the Admin's daily
--     buckets are the same local days its date ranges use.
--   • admin_site_stats: "signups" now means a completed sign-up (their plan
--     started: trial, or paid straight away); "abandoned_signups" = made an
--     account but never finished plan checkout. Team accounts excluded.
-- Sign-up = completed sign-up. Trial = signed up, still in the free period.
-- Someone who didn't finish is an abandoned sign-up, never a sign-up.

CREATE OR REPLACE FUNCTION public.admin_is_internal(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = p_user)
      OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user
                  AND (u.email ILIKE '%@bakeriapp.com' OR u.email = 'thebakeriapp@gmail.com'));
$$;

CREATE OR REPLACE FUNCTION public.admin_user_name(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT coalesce(nullif(p.business_name, ''), nullif(p.user_name, ''), u.email, 'Unknown')
  FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
  WHERE u.id = p_user;
$$;

-- A plan sign-up: someone whose plan started (trial, or paid with no trial).
CREATE OR REPLACE FUNCTION public.admin_plan_started_at(vp public.vendor_plans)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$ SELECT coalesce(vp.trial_used_at, vp.first_paid_at); $$;

-- When someone became a user: completed sign-up (plan started: trial, or paid
-- with no trial), or account creation for those who joined before plans
-- existed (grandfathered). NULL = not a user (abandoned sign-up, or a Growth
-- Partner). An email-only account is never a user (Harvey 2026-11-15).
CREATE OR REPLACE FUNCTION public.admin_signed_up_at(p_user UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT coalesce(vp.trial_used_at, vp.first_paid_at,
                  CASE WHEN vp.grandfathered_starter THEN u.created_at END)
  FROM auth.users u LEFT JOIN vendor_plans vp ON vp.user_id = u.id
  WHERE u.id = p_user;
$$;

-- The account made by a site sign-up event (created within two minutes of
-- it), and whether that person completed sign-up.
CREATE OR REPLACE FUNCTION public.admin_site_signup_user(p_at TIMESTAMPTZ)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id FROM auth.users u
  WHERE p_at IS NOT NULL
    AND u.created_at BETWEEN p_at - interval '2 minutes' AND p_at + interval '2 minutes'
  ORDER BY abs(extract(epoch FROM u.created_at - p_at)) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.admin_site_signup_completed(p_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT admin_signed_up_at(admin_site_signup_user(p_at)) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_order_metrics(p_days integer DEFAULT 30, p_tz text DEFAULT 'UTC')
 RETURNS TABLE(day date, order_count bigint, daily_gtv numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select (o.created_at at time zone p_tz)::date               as day,
           count(distinct o.id)                                 as order_count,
           coalesce(sum(oi.price_per_unit * oi.quantity), 0)   as daily_gtv
      from orders o
      left join order_items oi on oi.order_id = o.id and oi.deleted_at is null
     where o.deleted_at is null
       and o.created_at >= now() - (p_days || ' days')::interval
       and not exists (select 1 from public.admin_team_accounts t where t.user_id = o.user_id)
     group by 1
     order by day;
$function$;
DROP FUNCTION IF EXISTS public.admin_daily_order_metrics(integer);

CREATE OR REPLACE FUNCTION public.admin_drill(
    p_metric TEXT,
    p_from   TIMESTAMPTZ DEFAULT NULL,
    p_to     TIMESTAMPTZ DEFAULT NULL,
    p_key    TEXT        DEFAULT NULL,
    p_tz     TEXT        DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    t_from TIMESTAMPTZ := coalesce(p_from, '-infinity'::timestamptz);
    t_to   TIMESTAMPTZ := coalesce(p_to, 'infinity'::timestamptz);
    -- Site filters: "field=value&field=value" (value '' = not set).
    f      JSONB := '{}'::jsonb;
    part   TEXT;
    rows   JSONB;
BEGIN
    IF p_metric LIKE 'site_%' AND p_key IS NOT NULL AND p_key <> '' THEN
        FOREACH part IN ARRAY string_to_array(p_key, '&') LOOP
            f := f || jsonb_build_object(split_part(part, '=', 1),
                                         replace(substr(part, length(split_part(part, '=', 1)) + 2), '%26', '&'));
        END LOOP;
    END IF;

    CASE p_metric

    -- Users who signed up in the window (by sign-up date; see admin_signed_up_at).
    -- key: bakers | buyers | abandoned | null
    --   abandoned = abandoned sign-ups: an account started in the window that
    --   never completed sign-up (not a user, never counted as one).
    WHEN 'users' THEN
        SELECT jsonb_agg(x.j ORDER BY x.at DESC) INTO rows FROM (
          SELECT s.at, jsonb_build_object(
                 'id', u.id, 'user_id', u.id, 'at', s.at,
                 'title', coalesce(nullif(p.business_name, ''), nullif(p.user_name, ''), u.email),
                 'subtitle', concat_ws(' · ', u.email,
                     CASE WHEN p_key = 'abandoned' THEN 'abandoned sign-up'
                          WHEN vp.status IN ('trialing', 'active', 'past_due') THEN initcap(vp.tier) || ' · ' || vp.status
                          WHEN vp.grandfathered_starter AND vp.trial_used_at IS NULL AND vp.first_paid_at IS NULL THEN 'Free Starter (joined before plans)'
                          ELSE 'Plan ended' END)) AS j
          FROM auth.users u
          LEFT JOIN profiles p ON p.id = u.id
          LEFT JOIN vendor_plans vp ON vp.user_id = u.id
          CROSS JOIN LATERAL (SELECT CASE WHEN p_key = 'abandoned' THEN u.created_at
                                          ELSE admin_signed_up_at(u.id) END AS at) s
          WHERE NOT admin_is_internal(u.id)
            AND coalesce(p.is_partner_page, false) = false
            AND NOT EXISTS (SELECT 1 FROM growth_partners g WHERE g.user_id = u.id)
            AND s.at >= t_from AND s.at < t_to
            AND CASE p_key
                  WHEN 'abandoned' THEN admin_signed_up_at(u.id) IS NULL
                  WHEN 'bakers' THEN admin_signed_up_at(u.id) IS NOT NULL AND coalesce(p.business_name, '') <> ''
                  WHEN 'buyers' THEN admin_signed_up_at(u.id) IS NOT NULL AND coalesce(p.business_name, '') = ''
                  ELSE admin_signed_up_at(u.id) IS NOT NULL END
        ) x;

    -- Sign-ups (completed: plan started, trial or paid) in the window; trials;
    -- first payments; paying and on-trial right now.
    WHEN 'plan_signups', 'trials', 'first_paid', 'paying_now', 'trialing_now' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', vp.user_id, 'user_id', vp.user_id,
                 'at', CASE p_metric WHEN 'trials' THEN vp.trial_used_at WHEN 'first_paid' THEN vp.first_paid_at
                                     WHEN 'plan_signups' THEN admin_plan_started_at(vp) ELSE vp.updated_at END,
                 'title', admin_user_name(vp.user_id),
                 'subtitle', concat_ws(' · ', initcap(vp.tier), vp.billing_interval || 'ly', vp.status,
                     CASE WHEN vp.status = 'trialing' AND vp.trial_end IS NOT NULL
                          THEN 'trial ends ' || to_char(vp.trial_end AT TIME ZONE p_tz, 'Mon DD') END,
                     CASE WHEN vp.lifetime_pro THEN 'lifetime Pro' END))
               ORDER BY 3 DESC)
        INTO rows
        FROM vendor_plans vp
        WHERE NOT admin_is_internal(vp.user_id)
          AND CASE p_metric
                WHEN 'plan_signups' THEN admin_plan_started_at(vp) >= t_from AND admin_plan_started_at(vp) < t_to
                WHEN 'trials'       THEN vp.trial_used_at >= t_from AND vp.trial_used_at < t_to
                WHEN 'first_paid'   THEN vp.first_paid_at >= t_from AND vp.first_paid_at < t_to
                WHEN 'paying_now'   THEN vp.status = 'active' AND vp.tier <> 'none'
                WHEN 'trialing_now' THEN vp.status = 'trialing'
              END;
        -- jsonb_agg ORDER BY 3 isn't positional; sort here instead.
        SELECT jsonb_agg(r ORDER BY r->>'at' DESC NULLS LAST) INTO rows FROM jsonb_array_elements(rows) r;

    -- Orders placed. key: ':'-separated parts — a vendor uuid and/or flags
    -- paid | storefront | checkout | offline | quotes | deposits | forms
    WHEN 'orders' THEN
        SELECT jsonb_agg(x.j ORDER BY x.at DESC) INTO rows FROM (
          SELECT o.created_at AS at, jsonb_build_object(
                 'id', o.id, 'order_id', o.id, 'user_id', o.user_id, 'at', o.created_at,
                 'title', coalesce(nullif(o.order_name, ''), nullif(o.customer_name, ''), nullif(o.buyer_display_name, ''), 'Order'),
                 'subtitle', concat_ws(' · ', admin_user_name(o.user_id),
                     nullif(coalesce(o.customer_name, o.buyer_display_name), o.order_name),
                     CASE WHEN o.order_source = 'marketplace' THEN 'storefront' ELSE o.order_source END,
                     CASE WHEN o.is_paid THEN 'paid' ELSE 'unpaid' END,
                     nullif(o.status, '')),
                 'value', coalesce((SELECT sum(oi.price_per_unit * oi.quantity) FROM order_items oi
                                     WHERE oi.order_id = o.id AND oi.deleted_at IS NULL), 0)) AS j
          FROM orders o
          WHERE o.deleted_at IS NULL
            AND o.created_at >= t_from AND o.created_at < t_to
            AND NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = o.user_id)
            -- key parts (any order, ':'-separated): a vendor uuid, and flags
            AND (p_key IS NULL OR p_key = '' OR NOT EXISTS (
                  SELECT 1 FROM unnest(string_to_array(p_key, ':')) k
                  WHERE NOT CASE
                    WHEN k ~ '^[0-9a-f-]{36}$' THEN o.user_id = k::uuid
                    WHEN k = 'paid'       THEN coalesce(o.is_paid, false)
                    WHEN k = 'storefront' THEN o.order_source = 'marketplace'
                    WHEN k = 'checkout'   THEN o.payment_intent_id IS NOT NULL OR o.deposit_payment_intent_id IS NOT NULL
                    WHEN k = 'offline'    THEN o.payment_intent_id IS NULL AND o.deposit_payment_intent_id IS NULL
                    WHEN k = 'quotes'     THEN o.quoted_price IS NOT NULL
                    WHEN k = 'deposits'   THEN o.invoice_type IN ('deposit', 'balance')
                    WHEN k = 'forms'      THEN o.form_responses IS NOT NULL
                    ELSE false END))
        ) x;

    -- A vendor's buyers by email (value = orders). key: <uuid> | <uuid>:repeat
    WHEN 'vendor_buyers' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.email, 'at', x.last_at, 'value', x.n, 'title', coalesce(x.name, x.email),
                 'subtitle', concat_ws(' · ', x.email, '$' || round(x.gtv::numeric, 2) || ' in orders'))
               ORDER BY x.n DESC, x.last_at DESC)
        INTO rows
        FROM (SELECT lower(o.customer_email) email, max(o.customer_name) name, count(*) n, max(o.created_at) last_at,
                     coalesce(sum((SELECT sum(oi.price_per_unit * oi.quantity) FROM order_items oi
                                    WHERE oi.order_id = o.id AND oi.deleted_at IS NULL)), 0) gtv
                FROM orders o
               WHERE o.deleted_at IS NULL AND coalesce(o.customer_email, '') <> ''
                 AND o.user_id::text = split_part(p_key, ':', 1)
                 AND o.created_at >= t_from AND o.created_at < t_to
               GROUP BY 1) x
        WHERE split_part(p_key, ':', 2) <> 'repeat' OR x.n > 1;

    -- A vendor's listings. key: <uuid> | <uuid>:<listing_kind>
    WHEN 'listings' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'user_id', m.user_id, 'at', m.created_at, 'title', coalesce(nullif(m.name, ''), 'Listing'),
                 'subtitle', concat_ws(' · ', initcap(replace(coalesce(m.listing_kind, 'other'), '_', ' ')),
                                       CASE WHEN coalesce(m.is_active, true) THEN 'active' ELSE 'hidden' END),
                 'value', m.default_price) ORDER BY m.created_at DESC)
        INTO rows
        FROM menu_items m
        WHERE m.deleted_at IS NULL AND m.user_id::text = split_part(p_key, ':', 1)
          AND (split_part(p_key, ':', 2) = '' OR m.listing_kind = split_part(p_key, ':', 2));

    -- Vendors with at least one order in the window (value = orders).
    WHEN 'active_vendors' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.user_id, 'user_id', x.user_id, 'at', x.last_at,
                 'title', admin_user_name(x.user_id),
                 'subtitle', x.n || CASE WHEN x.n = 1 THEN ' order · $' ELSE ' orders · $' END || round(x.gtv::numeric, 2),
                 'value', x.n) ORDER BY x.n DESC)
        INTO rows
        FROM (SELECT o.user_id, count(*) n, max(o.created_at) last_at,
                     coalesce(sum((SELECT sum(oi.price_per_unit * oi.quantity) FROM order_items oi
                                    WHERE oi.order_id = o.id AND oi.deleted_at IS NULL)), 0) gtv
                FROM orders o
               WHERE o.deleted_at IS NULL AND o.created_at >= t_from AND o.created_at < t_to
                 AND NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = o.user_id)
               GROUP BY o.user_id) x;

    -- Storefront page views per shop (value = views). key: optional shop uuid.
    WHEN 'shop_visits' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.shop_id, 'user_id', x.shop_id, 'at', x.last_at,
                 'title', admin_user_name(x.shop_id),
                 'subtitle', x.people || CASE WHEN x.people = 1 THEN ' visitor' ELSE ' visitors' END,
                 'value', x.n) ORDER BY x.n DESC)
        INTO rows
        FROM (SELECT e.shop_id, count(*) n, count(DISTINCT e.visitor) people, max(e.created_at) last_at
                FROM storefront_events e
               WHERE e.event = coalesce(nullif(split_part(p_key, ':', 2), ''), 'page_view')
                 AND e.created_at >= t_from AND e.created_at < t_to
                 AND NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = e.shop_id)
                 AND (nullif(split_part(p_key, ':', 1), '') IS NULL OR e.shop_id::text = split_part(p_key, ':', 1))
               GROUP BY e.shop_id) x;

    -- One shop's storefront visitors (value = their page views).
    -- key: <shop uuid> | <shop uuid>:<source,source…> (only views from those sources)
    WHEN 'shop_visitors' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.visitor, 'at', x.last_at, 'value', x.n,
                 'title', 'Visitor' || coalesce(' from ' || x.country, ''),
                 'subtitle', concat_ws(' · ', 'came from ' || initcap(x.source), x.device,
                                       CASE WHEN x.carts > 0 THEN x.carts || ' added to cart' END))
               ORDER BY x.last_at DESC)
        INTO rows
        FROM (SELECT e.visitor, count(*) FILTER (WHERE e.event = 'page_view'
                       AND (split_part(p_key, ':', 2) = '' OR e.source = ANY (string_to_array(split_part(p_key, ':', 2), ',')))) n,
                     count(*) FILTER (WHERE e.event = 'add_to_cart') carts, max(e.created_at) last_at,
                     (array_agg(coalesce(nullif(e.source, ''), 'direct') ORDER BY e.created_at))[1] source,
                     max(e.country) country, max(e.device) device
                FROM storefront_events e
               WHERE e.shop_id::text = split_part(p_key, ':', 1) AND e.created_at >= t_from AND e.created_at < t_to
               GROUP BY e.visitor) x
        WHERE x.n > 0;

    -- People who opened screens in the iPhone/web app (value = screens opened).
    -- key: ios | web | null
    WHEN 'app_people' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.user_id, 'user_id', x.user_id, 'at', x.last_at, 'value', x.n,
                 'title', admin_user_name(x.user_id),
                 'subtitle', 'Most opened: ' || x.top_screen) ORDER BY x.n DESC)
        INTO rows
        FROM (SELECT a.user_id, count(*) n, max(a.created_at) last_at,
                     mode() WITHIN GROUP (ORDER BY a.screen) top_screen
                FROM app_events a
               WHERE a.created_at >= t_from AND a.created_at < t_to
                 AND (p_key IS NULL OR p_key = '' OR (p_key = 'web') = (a.platform = 'web'))
                 AND NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = a.user_id)
               GROUP BY a.user_id) x;

    -- First storefront checkout sale per vendor, in the window.
    WHEN 'first_checkout_sales' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.user_id, 'user_id', x.user_id, 'at', x.at,
                 'title', admin_user_name(x.user_id), 'subtitle', 'First paid checkout order')
               ORDER BY x.at DESC)
        INTO rows
        FROM (SELECT user_id, min(created_at) at FROM orders
               WHERE deleted_at IS NULL AND (payment_intent_id IS NOT NULL OR deposit_payment_intent_id IS NOT NULL)
                 AND NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = orders.user_id)
               GROUP BY user_id) x
        WHERE x.at >= t_from AND x.at < t_to;

    -- Pipeline (creators, not tools-only prospects). key for crm_stage: stage name.
    WHEN 'crm_added', 'crm_contacted', 'crm_replied' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', c.id, 'user_id', c.user_id, 'at', x.at,
                 'title', coalesce(nullif(c.business_name, ''), nullif(c.name, ''), c.email),
                 'subtitle', concat_ws(' · ', c.email, initcap(replace(c.stage, '_', ' ')), c.owner))
               ORDER BY x.at DESC)
        INTO rows
        FROM crm_prospects c
        JOIN LATERAL (
          SELECT CASE p_metric
                   WHEN 'crm_added' THEN c.created_at
                   WHEN 'crm_contacted' THEN (SELECT max(a.created_at) FROM crm_activities a WHERE a.prospect_id = c.id AND a.kind = 'email'
                                               AND a.created_at >= t_from AND a.created_at < t_to)
                   ELSE (SELECT max(a.created_at) FROM crm_activities a WHERE a.prospect_id = c.id AND a.kind = 'stage'
                          AND a.body LIKE '%→ Replied%' AND a.created_at >= t_from AND a.created_at < t_to)
                 END AS at) x ON true
        WHERE c.fit <> 'tools'
          AND (c.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM admin_team_accounts t WHERE t.user_id = c.user_id))
          AND x.at >= t_from AND x.at < t_to;

    -- bakeriapp.com visitors whose events match the filters (value = matching
    -- events). Visitors in the EU/UK have a daily id and count once per day,
    -- as on the Website screen. Someone who signed up is matched to the
    -- account created within two minutes of their sign-up event.
    WHEN 'site_visitors' THEN
        WITH ev AS (
            SELECT e.*, CASE WHEN e.visitor LIKE 'd:%' THEN e.visitor || '@' || (e.created_at AT TIME ZONE p_tz)::date
                             ELSE e.visitor END AS vkey
            FROM site_events e
            WHERE e.created_at >= t_from AND e.created_at < t_to
        ),
        hit AS (
            SELECT * FROM ev
            WHERE (NOT f ? 'event'    OR event = ANY (string_to_array(f->>'event', '|')))
              -- completed: a sign-up event whose account went on to complete sign-up
              AND (NOT f ? 'completed' OR (event = 'signup_done' AND admin_site_signup_completed(created_at)))
              AND (NOT f ? 'path'     OR path = f->>'path')
              AND (NOT f ? 'ref'      OR coalesce(ref, '') = f->>'ref')
              AND (NOT f ? 'source'   OR coalesce(source, '') = f->>'source')
              AND (NOT f ? 'medium'   OR coalesce(medium, '') = f->>'medium')
              AND (NOT f ? 'campaign' OR coalesce(campaign, '') = f->>'campaign')
              AND (NOT f ? 'ref_code' OR coalesce(ref_code, '') = f->>'ref_code')
              AND (NOT f ? 'referrer' OR coalesce(referrer, '') = f->>'referrer')
              AND (NOT f ? 'device'   OR coalesce(device, '') = f->>'device')
              AND (NOT f ? 'browser'  OR coalesce(browser, '') = f->>'browser')
              AND (NOT f ? 'os'       OR coalesce(os, '') = f->>'os')
              AND (NOT f ? 'country'  OR coalesce(country, '') = f->>'country')
              AND (NOT f ? 'hour'     OR extract(hour FROM created_at AT TIME ZONE p_tz)::int = (f->>'hour')::int)
              AND (NOT f ? 'day'      OR (created_at AT TIME ZONE p_tz)::date = (f->>'day')::date)
              -- Credited by where the visit began (the Website day panel):
              AND (NOT f ? 'first_source' OR (SELECT coalesce(nullif(e2.source, ''), 'direct') FROM ev e2
                    WHERE e2.session = ev.session ORDER BY e2.created_at LIMIT 1) = f->>'first_source')
              AND (NOT f ? 'first_campaign' OR (SELECT nullif(e2.campaign, '') FROM ev e2
                    WHERE e2.session = ev.session ORDER BY e2.created_at LIMIT 1) = f->>'first_campaign')
              -- Events in a visit that carried a campaign tag (Promotions):
              AND (NOT f ? 'session_campaign' OR EXISTS (SELECT 1 FROM site_events e3
                    WHERE e3.session = ev.session AND e3.campaign = f->>'session_campaign'))
        ),
        v AS (
            SELECT h.vkey, count(*) n, min(h.created_at) first_at, max(h.created_at) last_at
            FROM hit h GROUP BY h.vkey
        ),
        info AS (
            SELECT v.vkey, v.n, v.first_at, v.last_at,
                   (array_agg(coalesce(nullif(e.source, ''), 'direct') ORDER BY e.created_at))[1] AS source,
                   (array_agg(nullif(e.campaign, '') ORDER BY e.created_at))[1] AS campaign,
                   (array_agg(e.path ORDER BY e.created_at) FILTER (WHERE e.event = 'page_view'))[1] AS landing,
                   count(*) FILTER (WHERE e.event = 'page_view') AS pages,
                   max(e.country) AS country, max(e.device) AS device,
                   min(e.created_at) FILTER (WHERE e.event = 'signup_done') AS signup_at
            FROM v JOIN ev e ON e.vkey = v.vkey
            GROUP BY v.vkey, v.n, v.first_at, v.last_at
        ),
        matched AS (
            SELECT i.*, admin_site_signup_user(i.signup_at) AS user_id FROM info i
        )
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.vkey, 'user_id', m.user_id, 'at', m.last_at, 'value', m.n,
                 'title', CASE WHEN m.user_id IS NOT NULL THEN admin_user_name(m.user_id)
                               ELSE 'Visitor' || coalesce(' from ' || m.country, '') END,
                 'subtitle', concat_ws(' · ',
                     'came from ' || initcap(m.source) || coalesce(' (' || m.campaign || ')', ''),
                     CASE WHEN m.landing IS NOT NULL THEN 'landed on ' || m.landing END,
                     m.pages || CASE WHEN m.pages = 1 THEN ' page' ELSE ' pages' END,
                     m.device,
                     CASE WHEN m.user_id IS NOT NULL AND admin_signed_up_at(m.user_id) IS NOT NULL THEN 'signed up'
                          WHEN m.signup_at IS NOT NULL THEN 'abandoned sign-up' END))
               ORDER BY m.last_at DESC)
        INTO rows FROM matched m;

    -- bakeriapp.com visits (sessions). key: bounced | multipage | landing=/path | null
    WHEN 'site_sessions' THEN
        WITH s AS (
            SELECT e.session,
                   count(*) FILTER (WHERE e.event = 'page_view') AS views,
                   min(e.created_at) AS started, max(e.created_at) AS ended,
                   (array_agg(e.path ORDER BY e.created_at) FILTER (WHERE e.event = 'page_view'))[1] AS landing,
                   (array_agg(coalesce(nullif(e.source, ''), 'direct') ORDER BY e.created_at))[1] AS source,
                   (array_agg(e.path ORDER BY e.created_at) FILTER (WHERE e.event = 'page_view')) AS paths,
                   max(e.country) AS country, max(e.device) AS device,
                   bool_or(e.event = 'signup_done') AS signed_up,
                   min(e.created_at) FILTER (WHERE e.event = 'signup_done') AS signup_at
            FROM site_events e
            WHERE e.created_at >= t_from AND e.created_at < t_to AND e.session IS NOT NULL
            GROUP BY e.session
        )
        SELECT jsonb_agg(jsonb_build_object(
                 'id', s.session, 'at', s.started,
                 'title', concat_ws(' → ', s.paths[1], s.paths[2], s.paths[3],
                                    CASE WHEN array_length(s.paths, 1) > 3 THEN '…' END),
                 'subtitle', concat_ws(' · ', 'from ' || initcap(s.source), s.views || CASE WHEN s.views = 1 THEN ' page' ELSE ' pages' END,
                                       s.country, s.device,
                                       CASE WHEN s.signed_up THEN CASE WHEN admin_site_signup_completed(s.signup_at) THEN 'signed up' ELSE 'abandoned sign-up' END END),
                 'value', CASE WHEN f ? 'multipage' OR p_key = 'multipage' THEN extract(epoch FROM s.ended - s.started) ELSE s.views END,
                 'display', CASE WHEN f ? 'multipage' OR p_key = 'multipage'
                                 THEN CASE WHEN extract(epoch FROM s.ended - s.started) < 60
                                           THEN round(extract(epoch FROM s.ended - s.started)) || 's'
                                           ELSE floor(extract(epoch FROM s.ended - s.started) / 60) || 'm ' || round(extract(epoch FROM s.ended - s.started))::int % 60 || 's' END END)
               ORDER BY s.started DESC)
        INTO rows FROM s
        WHERE CASE WHEN p_key = 'bounced' THEN s.views <= 1
                   WHEN p_key = 'multipage' THEN s.views > 1
                   WHEN f ? 'landing' THEN s.landing = f->>'landing'
                   ELSE true END;

    -- Support tickets. key: open | resolved | escalated | category=<c> | null
    WHEN 'tickets' THEN
        SELECT jsonb_agg(jsonb_build_object(
                 'id', fb.id, 'user_id', fb.user_id, 'at', fb.created_at,
                 'title', left(regexp_replace(coalesce(fb.message, ''), '\s+', ' ', 'g'), 90),
                 'subtitle', concat_ws(' · ', admin_user_name(fb.user_id), initcap(replace(fb.category, '_', ' ')),
                                       coalesce(fb.admin_status, 'open')))
               ORDER BY fb.created_at DESC)
        INTO rows FROM feedback fb
        WHERE fb.created_at >= t_from AND fb.created_at < t_to
          AND CASE WHEN p_key IS NULL OR p_key = '' THEN true
                   WHEN p_key = 'open' THEN coalesce(fb.admin_status, 'open') = 'open'
                   WHEN p_key = 'resolved' THEN fb.admin_status IN ('resolved', 'archived')
                   WHEN p_key = 'escalated' THEN fb.admin_status = 'escalated'
                   WHEN p_key LIKE 'category=%' THEN fb.category = substr(p_key, 10)
                   ELSE false END;

    ELSE
        RAISE EXCEPTION 'unknown metric %', p_metric;
    END CASE;

    RETURN coalesce(rows, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_drill(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drill(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.admin_is_internal(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_name(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_is_internal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_name(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.admin_signed_up_at(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_signed_up_at(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.admin_site_signup_user(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_site_signup_completed(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_site_signup_user(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_site_signup_completed(TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.admin_daily_order_metrics(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_order_metrics(integer, text) TO service_role;
