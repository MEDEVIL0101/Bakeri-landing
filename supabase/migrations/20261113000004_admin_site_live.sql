-- Bakeri Admin → Website "Visitors right now" (Harvey 2026-11-13): everyone
-- with any site event in the last p_minutes, one row per visitor — the page
-- they're on now, where they came from (their session's first event), device,
-- country, pages this session and when they were last seen. Service role only.

CREATE OR REPLACE FUNCTION public.admin_site_live(p_minutes INT DEFAULT 5)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT DISTINCT ON (visitor) visitor, session, path, event, device, country, created_at
    FROM site_events
    WHERE created_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60)))
    ORDER BY visitor, created_at DESC
  ),
  firsts AS (
    SELECT DISTINCT ON (e.session) e.session,
           coalesce(nullif(e.source, ''), nullif(e.referrer, ''), 'direct') AS source,
           nullif(e.campaign, '') AS campaign, e.path AS landing
    FROM site_events e JOIN recent r ON r.session = e.session
    ORDER BY e.session, e.created_at
  ),
  counts AS (
    SELECT e.session, count(*) FILTER (WHERE e.event = 'page_view') AS pages
    FROM site_events e JOIN recent r ON r.session = e.session
    GROUP BY e.session
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM recent),
    'visitors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'path', r.path, 'event', r.event, 'device', r.device, 'country', r.country,
        'last_seen', r.created_at, 'source', f.source, 'campaign', f.campaign,
        'landing', f.landing, 'pages', coalesce(c.pages, 0)
      ) ORDER BY r.created_at DESC)
      FROM recent r LEFT JOIN firsts f ON f.session = r.session LEFT JOIN counts c ON c.session = r.session), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_site_live(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_site_live(INT) TO service_role;
