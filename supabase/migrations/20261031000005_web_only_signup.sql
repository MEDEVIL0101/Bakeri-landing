-- All account creation goes through the website (Harvey 2026-10-31). The
-- iPhone app is sign-in only; its "Don't yet have an account?" opens the
-- web app's sign-up. This Auth hook (before-user-created) refuses any new
-- account that didn't come from the web app's sign-up form, which tags
-- itself with user_metadata.signup_source = 'web' — so older app builds
-- that still have a sign-up form, and a first-time Sign in with Apple, can't
-- create accounts. Existing accounts, Apple ones included, sign in as before
-- (the hook only runs when an account is created).

CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(event #>> '{user,app_metadata,provider}', 'email') = 'email'
       AND event #>> '{user,user_metadata,signup_source}' = 'web' THEN
        RETURN '{}'::jsonb;
    END IF;
    RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'New Bakeri accounts are created at bakeriapp.com. Create yours there, then sign in here.'));
END;
$$;

REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin;
