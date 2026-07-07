-- Fires the send-vendor-ack-email edge function after a vendor application
-- is successfully inserted (i.e. it passed the rate-limit trigger and all
-- CHECK constraints). Follows the same net.http_post + vault-secret pattern
-- as send_marketplace_notification(), reading the shared webhook secret from
-- Vault instead of hardcoding it in the migration.

CREATE OR REPLACE FUNCTION public.notify_vendor_application()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'bakeri_webhook_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/send-vendor-ack-email',
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'x-webhook-secret', v_secret
      ),
      body    := jsonb_build_object(
        'type',   'INSERT',
        'table',  'vendor_applications',
        'record', jsonb_build_object(
          'first_name',  NEW.first_name,
          'bakery_name', NEW.bakery_name,
          'email',       NEW.email,
          'bake_types',  NEW.bake_types
        )
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_vendor_application ON public.vendor_applications;
CREATE TRIGGER trg_notify_vendor_application
AFTER INSERT ON public.vendor_applications
FOR EACH ROW EXECUTE FUNCTION public.notify_vendor_application();
