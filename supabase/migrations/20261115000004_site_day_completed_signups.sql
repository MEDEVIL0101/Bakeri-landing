-- Website promotions + click-a-day panel (Harvey 2026-11-15): sign-ups are
-- completed sign-ups only (the account went on to start its plan), as on the
-- rest of the Website screen. Needs admin_site_signup_completed (20261115000001).

CREATE OR REPLACE FUNCTION public.admin_site_promotions(
    p_from DATE,
    p_to   DATE,
    p_tz   TEXT DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (p_from::timestamp) AT TIME ZONE p_tz AS t_from,
           ((p_to + 1)::timestamp) AT TIME ZONE p_tz AS t_to
  ),
  promos AS (
    SELECT p.id::text AS id, p.name, p.channel, p.campaign, p.starts_at, p.ends_at, p.spend, p.notes, false AS is_sale
    FROM site_promotions p
    UNION ALL
    SELECT s.id, s.label || ' sale: ' || s.percent_off || '% off ' || s.months || ' months', 'sale', NULL,
           coalesce(s.starts_at, s.created_at),
           CASE WHEN s.active THEN s.ends_at ELSE least(coalesce(s.ends_at, now()), now()) END,
           NULL, NULL, true
    FROM plan_sales s WHERE s.active OR s.starts_at IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'channel', p.channel, 'campaign', p.campaign,
      'starts_at', p.starts_at, 'ends_at', p.ends_at, 'spend', p.spend, 'notes', p.notes, 'is_sale', p.is_sale,
      'visitors', (SELECT count(DISTINCT e.visitor) FROM site_events e
                   WHERE p.campaign IS NOT NULL AND e.campaign = p.campaign),
      'signups', (SELECT count(DISTINCT e.visitor) FROM site_events e
                  WHERE e.event = 'signup_done' AND p.campaign IS NOT NULL
                    AND admin_site_signup_completed(e.created_at)
                    AND e.session IN (SELECT session FROM site_events WHERE campaign = p.campaign AND session IS NOT NULL))
    ) ORDER BY p.starts_at DESC), '[]'::jsonb)
  FROM promos p, bounds b
  WHERE p.starts_at < b.t_to AND (p.ends_at IS NULL OR p.ends_at >= b.t_from);
$$;

-- One day (p_day in p_tz) broken down: totals, visitors by source and by
-- campaign (a session counts toward where its first visit came from), and the
-- promotions running that day.
CREATE OR REPLACE FUNCTION public.admin_site_day(
    p_day DATE,
    p_tz  TEXT DEFAULT 'America/Toronto'
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT * FROM site_events
    WHERE created_at >= (p_day::timestamp) AT TIME ZONE p_tz
      AND created_at <  ((p_day + 1)::timestamp) AT TIME ZONE p_tz
  ),
  sess AS (
    SELECT coalesce(session, visitor) AS s,
           (array_agg(visitor ORDER BY created_at))[1] AS visitor,
           (array_agg(coalesce(nullif(source, ''), 'direct') ORDER BY created_at))[1] AS source,
           (array_agg(nullif(campaign, '') ORDER BY created_at))[1] AS campaign,
           bool_or(event = 'signup_done' AND admin_site_signup_completed(created_at)) AS signed_up
    FROM ev GROUP BY 1
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'visitors', (SELECT count(DISTINCT visitor) FROM ev),
    'views', (SELECT count(*) FROM ev WHERE event = 'page_view'),
    'signups', (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_done' AND admin_site_signup_completed(created_at)),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source, 'visitors', n, 'signups', su) ORDER BY n DESC) FROM (
        SELECT source, count(DISTINCT visitor) n, count(DISTINCT visitor) FILTER (WHERE signed_up) su
        FROM sess GROUP BY source) x), '[]'::jsonb),
    'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('campaign', campaign, 'source', source, 'visitors', n, 'signups', su) ORDER BY n DESC) FROM (
        SELECT campaign, source, count(DISTINCT visitor) n, count(DISTINCT visitor) FILTER (WHERE signed_up) su
        FROM sess WHERE campaign IS NOT NULL GROUP BY campaign, source) x), '[]'::jsonb),
    'promotions', admin_site_promotions(p_day, p_day, p_tz)
  );
$$;

