-- Who's online in the web app (Harvey 2026-11-02), for Bakeri Admin's
-- "Online now". The iPhone app already heartbeats user_presence (one row per
-- user, platform 'ios'); the web app gets its own table so neither overwrites
-- the other and installed app builds keep working unchanged. The web app
-- upserts its own row about once a minute while a tab is open and visible.
CREATE TABLE IF NOT EXISTS public.web_presence (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent   TEXT
);

ALTER TABLE public.web_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS web_presence_own_row ON public.web_presence;
CREATE POLICY web_presence_own_row ON public.web_presence
    FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Same 2FA rule as every other table (20261031000004_mfa_enforcement).
DROP POLICY IF EXISTS mfa_required ON public.web_presence;
CREATE POLICY mfa_required ON public.web_presence AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

REVOKE ALL ON public.web_presence FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.web_presence TO authenticated;
