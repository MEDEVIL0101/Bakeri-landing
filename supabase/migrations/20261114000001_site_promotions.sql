-- Bakeri Admin → Website promotions (Harvey 2026-11-14): a list of what we ran
-- (ads, stories, posts, emails…) with start/end dates, drawn as bands on the
-- traffic graph; clicking a day shows that day's sources, campaigns and what
-- was running. Plan sales (plan_sales) show as promotions automatically.
-- A promotion's `campaign` is the utm_campaign its link carries (bf-2026…),
-- which is how visits are credited to it. Service role only.

CREATE TABLE IF NOT EXISTS public.site_promotions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    channel    TEXT NOT NULL DEFAULT 'other',   -- tiktok, instagram, facebook, email, partner, other
    campaign   TEXT,                            -- utm_campaign on the promotion's link
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ,                     -- NULL = still running
    spend      NUMERIC(10, 2),                  -- dollars, optional
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.site_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_promotions FROM anon, authenticated;

INSERT INTO public.site_promotions (name, channel, campaign, starts_at, ends_at, notes) VALUES
  ('TikTok ad: Black Friday', 'tiktok', 'bf-2026', '2026-11-14 00:00:00+00', NULL, 'Two best creatives, TikTok targeting'),
  ('Instagram story: Black Friday', 'instagram', 'bf-2026-story', '2026-11-14 03:00:00+00', '2026-11-15 03:00:00+00', 'Stories last 24 hours');

-- Promotions overlapping [p_from, p_to] (dates in p_tz), plan sales included,
-- each with the visitors its campaign tag brought and their sign-ups.
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
           bool_or(event = 'signup_done') AS signed_up
    FROM ev GROUP BY 1
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'visitors', (SELECT count(DISTINCT visitor) FROM ev),
    'views', (SELECT count(*) FROM ev WHERE event = 'page_view'),
    'signups', (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_done'),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', source, 'visitors', n, 'signups', su) ORDER BY n DESC) FROM (
        SELECT source, count(DISTINCT visitor) n, count(DISTINCT visitor) FILTER (WHERE signed_up) su
        FROM sess GROUP BY source) x), '[]'::jsonb),
    'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('campaign', campaign, 'source', source, 'visitors', n, 'signups', su) ORDER BY n DESC) FROM (
        SELECT campaign, source, count(DISTINCT visitor) n, count(DISTINCT visitor) FILTER (WHERE signed_up) su
        FROM sess WHERE campaign IS NOT NULL GROUP BY campaign, source) x), '[]'::jsonb),
    'promotions', admin_site_promotions(p_day, p_day, p_tz)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_site_promotions(DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_site_day(DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_site_promotions(DATE, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_site_day(DATE, TEXT) TO service_role;
GRANT ALL ON public.site_promotions TO service_role;
