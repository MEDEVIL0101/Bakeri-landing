-- Email hello@bakeriapp.com when a new account is created (Harvey 2026-11-13).
-- Fire-and-forget via pg_net, so a slow or failed email never blocks sign-up.
-- Growth Partner invites are skipped: the team sent those itself.
-- Trials / paid plans are announced by stripe-billing-webhook.

CREATE OR REPLACE FUNCTION public.notify_team_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.raw_user_meta_data->>'signup_source', '') = 'partner_invite' THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/notify-team-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
      ),
      body := jsonb_build_object('user_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_team_signup failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_team_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_team_signup ON auth.users;
CREATE TRIGGER trg_notify_team_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.notify_team_signup();
