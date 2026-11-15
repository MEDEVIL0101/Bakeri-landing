-- Website screen (Harvey 2026-11-15): a sign-up is a COMPLETED sign-up (plan
-- started). signups, previous.signups, by_day.signups and the per-source /
-- campaign / code sign-up columns now count only those. accounts_created =
-- accounts made on the site; abandoned_signups = accounts that never finished
-- plan checkout. Team accounts and internal addresses excluded.

CREATE OR REPLACE FUNCTION public.admin_site_stats(p_from date, p_to date, p_tz text DEFAULT 'America/Toronto'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    t_from TIMESTAMPTZ := (p_from::timestamp) AT TIME ZONE p_tz;
    t_to   TIMESTAMPTZ := ((p_to + 1)::timestamp) AT TIME ZONE p_tz;
    span   INTERVAL;
    result JSONB;
BEGIN
    IF p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'bad date range'; END IF;
    span := t_to - t_from;

    WITH ev AS (
        SELECT * FROM site_events WHERE created_at >= t_from AND created_at < t_to
    ),
    prev AS (
        SELECT * FROM site_events WHERE created_at >= t_from - span AND created_at < t_from
    ),
    -- A sign-up is a completed one: the account made with this sign-up event
    -- (within two minutes of it) went on to start its plan. Accounts that
    -- never finished checkout are abandoned sign-ups, not sign-ups.
    done AS (
        SELECT e.id FROM site_events e
        WHERE e.event = 'signup_done' AND e.created_at >= t_from - span AND e.created_at < t_to
          AND EXISTS (SELECT 1 FROM auth.users u JOIN vendor_plans vp ON vp.user_id = u.id
                      WHERE u.created_at BETWEEN e.created_at - interval '2 minutes' AND e.created_at + interval '2 minutes'
                        AND coalesce(vp.trial_used_at, vp.first_paid_at) IS NOT NULL)
    ),
    completed AS (
        SELECT vp.user_id, coalesce(vp.trial_used_at, vp.first_paid_at) AS at FROM vendor_plans vp
        WHERE coalesce(vp.trial_used_at, vp.first_paid_at) >= t_from - span
          AND coalesce(vp.trial_used_at, vp.first_paid_at) < t_to
          AND NOT admin_is_internal(vp.user_id)
    ),
    -- Daily-hash ids change every day: count those per day.
    vis AS (
        SELECT DISTINCT CASE WHEN visitor LIKE 'd:%'
                             THEN visitor || '@' || (created_at AT TIME ZONE p_tz)::date
                             ELSE visitor END AS v
        FROM ev
    ),
    sess AS (
        SELECT session,
               count(*) FILTER (WHERE event = 'page_view') AS views,
               min(created_at) AS started, max(created_at) AS ended,
               (array_agg(path ORDER BY created_at) FILTER (WHERE event = 'page_view'))[1] AS landing,
               (array_agg(source ORDER BY created_at))[1] AS source
        FROM ev WHERE session IS NOT NULL GROUP BY session
    ),
    -- New Bakeri accounts and plan sign-ups in the same window (the real
    -- outcome the site is for).
    accounts AS (
        SELECT jsonb_array_length(admin_drill('users', t_from, t_to, NULL, p_tz)) AS n
    ),
    abandoned AS (
        SELECT jsonb_array_length(admin_drill('users', t_from, t_to, 'abandoned', p_tz)) AS n
    ),
    plans AS (
        SELECT count(*) FILTER (WHERE trial_used_at >= t_from AND trial_used_at < t_to) AS trials,
               count(*) FILTER (WHERE status = 'active' AND tier <> 'none') AS paying_now,
               count(*) FILTER (WHERE status = 'trialing') AS trialing_now
        FROM vendor_plans WHERE NOT admin_is_internal(user_id)
    )
    SELECT jsonb_build_object(
        'totals', jsonb_build_object(
            'visitors',     (SELECT count(*) FROM vis),
            'views',        (SELECT count(*) FROM ev WHERE event = 'page_view'),
            'sessions',     (SELECT count(*) FROM sess),
            'bounce_rate',  (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(*) FILTER (WHERE views <= 1) / count(*), 1) END FROM sess),
            'avg_session_seconds', (SELECT COALESCE(round(avg(extract(epoch FROM ended - started)) FILTER (WHERE views > 1)), 0) FROM sess),
            'pages_per_session',   (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(sum(views)::numeric / count(*), 2) END FROM sess),
            'cta_clicks',   (SELECT count(*) FROM ev WHERE event = 'cta_click'),
            'signup_forms', (SELECT count(*) FROM ev WHERE event = 'signup_form'),
            'signup_views', (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_view'),
            'signups',      (SELECT count(*) FROM completed WHERE at >= t_from),
            'accounts_created', (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_done'),
            'abandoned_signups', (SELECT n FROM abandoned),
            'checkouts',    (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'checkout_start'),
            'new_accounts', (SELECT n FROM accounts),
            'trials_started', (SELECT trials FROM plans),
            'paying_now',   (SELECT paying_now FROM plans),
            'trialing_now', (SELECT trialing_now FROM plans)
        ),
        'previous', jsonb_build_object(
            'visitors', (SELECT count(DISTINCT CASE WHEN visitor LIKE 'd:%' THEN visitor || '@' || (created_at AT TIME ZONE p_tz)::date ELSE visitor END) FROM prev),
            'views',    (SELECT count(*) FROM prev WHERE event = 'page_view'),
            'signups',  (SELECT count(*) FROM completed WHERE at < t_from)
        ),
        'live_visitors', (SELECT count(DISTINCT visitor) FROM site_events WHERE created_at > now() - interval '5 minutes'),
        'by_day', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
            SELECT jsonb_build_object(
                'day', (created_at AT TIME ZONE p_tz)::date,
                'views', count(*) FILTER (WHERE event = 'page_view'),
                'visitors', count(DISTINCT visitor),
                'signups', (SELECT count(*) FROM completed c WHERE c.at >= t_from
                              AND (c.at AT TIME ZONE p_tz)::date = (min(ev.created_at) AT TIME ZONE p_tz)::date)
            ) AS d
            FROM ev GROUP BY (created_at AT TIME ZONE p_tz)::date) x), '[]'::jsonb),
        'by_hour', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'views', n) ORDER BY h) FROM (
            SELECT extract(hour FROM created_at AT TIME ZONE p_tz)::int h, count(*) n
            FROM ev WHERE event = 'page_view' GROUP BY 1) x), '[]'::jsonb),
        'pages', COALESCE((SELECT jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visitors', visitors) ORDER BY views DESC) FROM (
            SELECT path, count(*) views, count(DISTINCT visitor) visitors
            FROM ev WHERE event = 'page_view' GROUP BY path ORDER BY 2 DESC LIMIT 30) x), '[]'::jsonb),
        'landing', COALESCE((SELECT jsonb_agg(jsonb_build_object('path', landing, 'sessions', n, 'bounce_rate', br) ORDER BY n DESC) FROM (
            SELECT landing, count(*) n, round(100.0 * count(*) FILTER (WHERE views <= 1) / count(*), 1) br
            FROM sess WHERE landing IS NOT NULL GROUP BY landing ORDER BY 2 DESC LIMIT 15) x), '[]'::jsonb),
        'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source, 'visitors', n, 'signups', s) ORDER BY n DESC) FROM (
            SELECT source, count(DISTINCT visitor) n,
                   count(DISTINCT visitor) FILTER (WHERE id IN (SELECT id FROM done)) s
            FROM ev GROUP BY source ORDER BY 2 DESC LIMIT 20) x), '[]'::jsonb),
        'referrers', COALESCE((SELECT jsonb_agg(jsonb_build_object('host', referrer, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT referrer, count(DISTINCT visitor) n FROM ev
            WHERE referrer IS NOT NULL GROUP BY referrer ORDER BY 2 DESC LIMIT 20) x), '[]'::jsonb),
        'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('campaign', campaign, 'source', source, 'medium', medium, 'visitors', n, 'signups', s) ORDER BY n DESC) FROM (
            SELECT campaign, source, medium, count(DISTINCT visitor) n,
                   count(DISTINCT visitor) FILTER (WHERE id IN (SELECT id FROM done)) s
            FROM ev WHERE campaign IS NOT NULL GROUP BY campaign, source, medium ORDER BY 4 DESC LIMIT 20) x), '[]'::jsonb),
        'referral_codes', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', ref_code, 'visitors', n, 'signups', s) ORDER BY n DESC) FROM (
            SELECT ref_code, count(DISTINCT visitor) n,
                   count(DISTINCT visitor) FILTER (WHERE id IN (SELECT id FROM done)) s
            FROM ev WHERE ref_code IS NOT NULL GROUP BY ref_code ORDER BY 2 DESC LIMIT 20) x), '[]'::jsonb),
        'ctas', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', ref, 'path', path, 'clicks', n) ORDER BY n DESC) FROM (
            SELECT ref, path, count(*) n FROM ev
            WHERE event = 'cta_click' AND ref IS NOT NULL GROUP BY ref, path ORDER BY 3 DESC LIMIT 20) x), '[]'::jsonb),
        'scroll', COALESCE((SELECT jsonb_agg(jsonb_build_object('path', path, 'depth', ref, 'visitors', n) ORDER BY path, ref::int) FROM (
            SELECT path, ref, count(DISTINCT visitor) n FROM ev
            WHERE event = 'scroll_depth' AND ref ~ '^[0-9]+$' GROUP BY path, ref) x), '[]'::jsonb),
        'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', device, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT device, count(DISTINCT visitor) n FROM ev GROUP BY device) x), '[]'::jsonb),
        'browsers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', browser, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT browser, count(DISTINCT visitor) n FROM ev GROUP BY browser) x), '[]'::jsonb),
        'os', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', os, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT os, count(DISTINCT visitor) n FROM ev GROUP BY os) x), '[]'::jsonb),
        'countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', country, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT country, count(DISTINCT visitor) n FROM ev WHERE country IS NOT NULL GROUP BY country ORDER BY 2 DESC LIMIT 25) x), '[]'::jsonb)
    ) INTO result;
    RETURN result;
END;
$function$
;
