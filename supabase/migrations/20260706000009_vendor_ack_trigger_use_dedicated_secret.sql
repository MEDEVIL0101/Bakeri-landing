-- Point notify_vendor_application() at the dedicated 'vendor_ack_webhook_secret'
-- vault entry created in 20260706000008 (matches the VENDOR_ACK_WEBHOOK_SECRET
-- edge function secret) instead of 'bakeri_webhook_secret', which doesn't
-- exist in this project's Vault at all — that's why no email ever sent.
--
-- Also drops the temporary secret-reading RPC from 20260706000008 now that
-- it's served its one-time purpose; leaving it exposed to anon would let
-- anyone read this secret back out.

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
    WHERE name = 'vendor_ack_webhook_secret'
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

DROP FUNCTION IF EXISTS public.debug_get_vendor_ack_secret();
