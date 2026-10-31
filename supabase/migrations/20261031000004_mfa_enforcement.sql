-- Two-factor authentication (Harvey 2026-10-31): optional authenticator-app
-- 2FA (Supabase TOTP MFA, already enabled on the project). Once a vendor has
-- a verified factor, a password-only (aal1) session can't read or write any
-- of their data — the app's code prompt isn't the only gate, the database is.
-- Accounts without 2FA are unaffected.

-- True when this request may touch data: no verified factor on the account,
-- or the session has entered its code (aal2).
CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        OR NOT EXISTS (
            SELECT 1 FROM auth.mfa_factors
            WHERE user_id = auth.uid() AND status = 'verified'
        );
$$;

REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO anon, authenticated, service_role;

-- A RESTRICTIVE policy is ANDed with every existing policy, so it narrows
-- what signed-in users already had and grants nothing new. (select …) makes
-- Postgres evaluate it once per query rather than per row.
DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t.relname);
        EXECUTE format(
            'CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
            'USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()))',
            t.relname);
    END LOOP;
END $$;

DROP POLICY IF EXISTS mfa_required ON storage.objects;
CREATE POLICY mfa_required ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
