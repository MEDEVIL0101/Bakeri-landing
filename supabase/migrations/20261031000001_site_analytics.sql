-- First-party analytics for Bakeri's own website (bakeriapp.com marketing
-- pages + the web app's sign-up funnel). No third-party service. Read by the
-- Bakeri Admin app (service role) through admin_site_stats().
--
-- Same visitor model as storefront analytics (20261030000002): a random
-- browser id from localStorage, except EU/EEA/UK/Swiss visitors (and any
-- request without a usable id), who get a daily-rotating salted hash of
-- IP + user agent instead. Raw IPs are never stored.

CREATE TABLE IF NOT EXISTS public.site_events (
    id         BIGSERIAL PRIMARY KEY,
    event      TEXT NOT NULL CHECK (event IN (
                   'page_view', 'cta_click', 'signup_form', 'signup_view',
                   'signup_done', 'plan_view', 'checkout_start', 'scroll_depth')),
    path       TEXT NOT NULL,   -- '/', '/referral-program.html', '/app/signup'…
    ref        TEXT,            -- CTA label / plan / scroll % the event is about
    referrer   TEXT,            -- referring host (google.com, instagram.com…), null = direct
    source     TEXT,            -- utm_source, else a name for the referrer, else 'direct'
    medium     TEXT,            -- utm_medium
    campaign   TEXT,            -- utm_campaign
    ref_code   TEXT,            -- ?ref= referral code
    device     TEXT,            -- mobile | tablet | desktop
    browser    TEXT,
    os         TEXT,
    country    TEXT,
    visitor    TEXT NOT NULL,   -- 'v:<uuid>' or 'd:<daily hash>'
    session    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_events_time ON public.site_events (created_at);
CREATE INDEX IF NOT EXISTS site_events_visitor ON public.site_events (visitor, created_at);
CREATE INDEX IF NOT EXISTS site_events_session ON public.site_events (session, created_at);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_site_event(
    p_event    TEXT,
    p_path     TEXT,
    p_ref      TEXT DEFAULT NULL,
    p_referrer TEXT DEFAULT NULL,
    p_source   TEXT DEFAULT NULL,
    p_medium   TEXT DEFAULT NULL,
    p_campaign TEXT DEFAULT NULL,
    p_ref_code TEXT DEFAULT NULL,
    p_session  TEXT DEFAULT NULL,
    p_visitor  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    headers JSON := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::json;
    ua      TEXT := COALESCE(headers->>'user-agent', '');
    ip      TEXT := COALESCE(headers->>'cf-connecting-ip',
                             NULLIF(split_part(COALESCE(headers->>'x-forwarded-for', ''), ',', 1), ''), '');
    country TEXT := NULLIF(upper(left(COALESCE(headers->>'cf-ipcountry', ''), 2)), '');
    v_host  TEXT := NULLIF(lower(regexp_replace(left(COALESCE(p_referrer, ''), 200), '^(https?://)?(www\.)?([^/:?#]+).*$', '\3')), '');
    v_src   TEXT;
    v_salt  TEXT;
    v_id    TEXT;
BEGIN
    IF p_event NOT IN ('page_view', 'cta_click', 'signup_form', 'signup_view',
                       'signup_done', 'plan_view', 'checkout_start', 'scroll_depth') THEN
        RETURN;
    END IF;
    IF ua = '' OR ua ~* '(bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|pingdom|uptime|preview|python|curl|wget|httpclient)' THEN
        RETURN;
    END IF;
    IF p_session IS NOT NULL AND (
        SELECT count(*) FROM site_events
        WHERE session = left(p_session, 40) AND created_at > now() - interval '10 minutes'
    ) >= 200 THEN
        RETURN;
    END IF;
    -- Our own pages aren't a referrer.
    IF v_host IN ('bakeriapp.com', 'bakeri.app') THEN v_host := NULL; END IF;

    v_src := NULLIF(lower(left(trim(COALESCE(p_source, '')), 60)), '');
    IF v_src IS NULL THEN
        v_src := CASE
            WHEN v_host IS NULL THEN 'direct'
            WHEN v_host ~ '(^|\.)google\.' THEN 'google'
            WHEN v_host ~ '(^|\.)bing\.com$' THEN 'bing'
            WHEN v_host ~ '(^|\.)duckduckgo\.com$' THEN 'duckduckgo'
            WHEN v_host ~ '(^|\.)(instagram\.com|l\.instagram\.com)$' THEN 'instagram'
            WHEN v_host ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$' THEN 'facebook'
            WHEN v_host ~ '(^|\.)tiktok\.com$' THEN 'tiktok'
            WHEN v_host ~ '(^|\.)(t\.co|twitter\.com|x\.com)$' THEN 'x'
            WHEN v_host ~ '(^|\.)pinterest\.' THEN 'pinterest'
            WHEN v_host ~ '(^|\.)linkedin\.com$' THEN 'linkedin'
            WHEN v_host ~ '(^|\.)reddit\.com$' THEN 'reddit'
            WHEN v_host ~ '(^|\.)youtube\.com$' THEN 'youtube'
            WHEN v_host ~ '(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)$' THEN 'ai assistant'
            ELSE v_host END;
    END IF;

    IF p_visitor ~ '^[0-9a-f-]{36}$'
       AND COALESCE(country, '') NOT IN (
           'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU',
           'MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB','CH') THEN
        v_id := 'v:' || p_visitor;
    ELSE
        INSERT INTO storefront_analytics_salts (day, salt)
        VALUES (current_date, encode(extensions.gen_random_bytes(16), 'hex'))
        ON CONFLICT (day) DO NOTHING;
        SELECT salt INTO v_salt FROM storefront_analytics_salts WHERE day = current_date;
        v_id := 'd:' || encode(extensions.digest(v_salt || ip || ua || 'site', 'sha256'), 'hex');
    END IF;

    INSERT INTO site_events (event, path, ref, referrer, source, medium, campaign, ref_code,
                             device, browser, os, country, visitor, session)
    VALUES (
        p_event,
        COALESCE(NULLIF(left(split_part(split_part(p_path, '?', 1), '#', 1), 120), ''), '/'),
        NULLIF(left(p_ref, 80), ''),
        v_host,
        v_src,
        NULLIF(lower(left(trim(COALESCE(p_medium, '')), 60)), ''),
        NULLIF(lower(left(trim(COALESCE(p_campaign, '')), 80)), ''),
        NULLIF(upper(left(regexp_replace(COALESCE(p_ref_code, ''), '[^A-Za-z0-9]', '', 'g'), 16)), ''),
        CASE WHEN ua ~* '(ipad|tablet)' THEN 'tablet'
             WHEN ua ~* '(mobi|iphone|ipod|android)' THEN 'mobile' ELSE 'desktop' END,
        CASE WHEN ua ~* 'edg/' THEN 'Edge'
             WHEN ua ~* '(opr/|opera)' THEN 'Opera'
             WHEN ua ~* 'samsungbrowser' THEN 'Samsung Internet'
             WHEN ua ~* '(instagram)' THEN 'Instagram app'
             WHEN ua ~* '(fban|fbav)' THEN 'Facebook app'
             WHEN ua ~* 'tiktok|bytedance' THEN 'TikTok app'
             WHEN ua ~* '(chrome|crios)/' THEN 'Chrome'
             WHEN ua ~* '(firefox|fxios)/' THEN 'Firefox'
             WHEN ua ~* 'safari/' THEN 'Safari'
             ELSE 'Other' END,
        CASE WHEN ua ~* '(iphone|ipad|ipod)' THEN 'iOS'
             WHEN ua ~* 'android' THEN 'Android'
             WHEN ua ~* 'mac os x' THEN 'macOS'
             WHEN ua ~* 'windows' THEN 'Windows'
             WHEN ua ~* 'cros' THEN 'ChromeOS'
             WHEN ua ~* 'linux' THEN 'Linux'
             ELSE 'Other' END,
        country, v_id, left(p_session, 40)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.log_site_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_site_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Everything the admin Website screen shows for [p_from, p_to] (dates in p_tz).
-- Service role only.
CREATE OR REPLACE FUNCTION public.admin_site_stats(
    p_from DATE,
    p_to   DATE,
    p_tz   TEXT DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        SELECT count(*) AS n FROM profiles p JOIN auth.users u ON u.id = p.id
        WHERE u.created_at >= t_from AND u.created_at < t_to
    ),
    plans AS (
        SELECT count(*) FILTER (WHERE trial_used_at >= t_from AND trial_used_at < t_to) AS trials,
               count(*) FILTER (WHERE status = 'active' AND tier <> 'none') AS paying_now,
               count(*) FILTER (WHERE status = 'trialing') AS trialing_now
        FROM vendor_plans
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
            'signups',      (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_done'),
            'checkouts',    (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'checkout_start'),
            'new_accounts', (SELECT n FROM accounts),
            'trials_started', (SELECT trials FROM plans),
            'paying_now',   (SELECT paying_now FROM plans),
            'trialing_now', (SELECT trialing_now FROM plans)
        ),
        'previous', jsonb_build_object(
            'visitors', (SELECT count(DISTINCT CASE WHEN visitor LIKE 'd:%' THEN visitor || '@' || (created_at AT TIME ZONE p_tz)::date ELSE visitor END) FROM prev),
            'views',    (SELECT count(*) FROM prev WHERE event = 'page_view'),
            'signups',  (SELECT count(DISTINCT visitor) FROM prev WHERE event = 'signup_done')
        ),
        'live_visitors', (SELECT count(DISTINCT visitor) FROM site_events WHERE created_at > now() - interval '5 minutes'),
        'by_day', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
            SELECT jsonb_build_object(
                'day', (created_at AT TIME ZONE p_tz)::date,
                'views', count(*) FILTER (WHERE event = 'page_view'),
                'visitors', count(DISTINCT visitor),
                'signups', count(DISTINCT visitor) FILTER (WHERE event = 'signup_done')
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
                   count(DISTINCT visitor) FILTER (WHERE event = 'signup_done') s
            FROM ev GROUP BY source ORDER BY 2 DESC LIMIT 20) x), '[]'::jsonb),
        'referrers', COALESCE((SELECT jsonb_agg(jsonb_build_object('host', referrer, 'visitors', n) ORDER BY n DESC) FROM (
            SELECT referrer, count(DISTINCT visitor) n FROM ev
            WHERE referrer IS NOT NULL GROUP BY referrer ORDER BY 2 DESC LIMIT 20) x), '[]'::jsonb),
        'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('campaign', campaign, 'source', source, 'medium', medium, 'visitors', n, 'signups', s) ORDER BY n DESC) FROM (
            SELECT campaign, source, medium, count(DISTINCT visitor) n,
                   count(DISTINCT visitor) FILTER (WHERE event = 'signup_done') s
            FROM ev WHERE campaign IS NOT NULL GROUP BY campaign, source, medium ORDER BY 4 DESC LIMIT 20) x), '[]'::jsonb),
        'referral_codes', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', ref_code, 'visitors', n, 'signups', s) ORDER BY n DESC) FROM (
            SELECT ref_code, count(DISTINCT visitor) n,
                   count(DISTINCT visitor) FILTER (WHERE event = 'signup_done') s
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
$$;

REVOKE ALL ON FUNCTION public.admin_site_stats(DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_site_stats(DATE, DATE, TEXT) TO service_role;

-- 13 months of raw events, same as storefront analytics.
SELECT cron.schedule(
    'site-analytics-prune',
    '29 4 * * *',
    $$ DELETE FROM public.site_events WHERE created_at < now() - interval '400 days'; $$
);
