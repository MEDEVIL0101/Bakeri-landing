-- Growth Partner invites (growth-partner-admin → generateLink invite) create
-- their account server-side, tagged signup_source = 'partner_invite'. Let
-- those through the web-only sign-up hook alongside the web app's form.

CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(event #>> '{user,app_metadata,provider}', 'email') = 'email'
       AND event #>> '{user,user_metadata,signup_source}' IN ('web', 'partner_invite') THEN
        RETURN '{}'::jsonb;
    END IF;
    RETURN jsonb_build_object('error', jsonb_build_object(
        'http_code', 403,
        'message', 'New Bakeri accounts are created at bakeriapp.com. Create yours there, then sign in here.'));
END;
$$;

REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin;
