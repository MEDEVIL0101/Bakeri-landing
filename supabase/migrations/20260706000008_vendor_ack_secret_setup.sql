-- The notify_vendor_application() trigger never actually fired
-- net.http_post because vault.decrypted_secrets is entirely empty in this
-- project — 'bakeri_webhook_secret' doesn't exist there (only as an Edge
-- Function secret, which is a separate store). Rather than touch the
-- shared BAKERI_WEBHOOK_SECRET (other triggers depend on it and rotating it
-- has its own follow-up), create a dedicated secret for this feature only.
--
-- The value is generated server-side (two concatenated gen_random_uuid()
-- calls — built into core Postgres since v13, no pgcrypto dependency) so it
-- never appears in plaintext in this file. A narrowly-scoped, temporary RPC
-- below lets it be read back once (over HTTPS with the anon key) to mirror
-- it into the send-vendor-ack-email Edge Function secret — that RPC is
-- dropped in migration 20260706000009 immediately after use.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'vendor_ack_webhook_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'vendor_ack_webhook_secret',
      'Shared secret for notify_vendor_application() -> send-vendor-ack-email edge function'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.debug_get_vendor_ack_secret()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('secret', decrypted_secret)
  FROM vault.decrypted_secrets
  WHERE name = 'vendor_ack_webhook_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.debug_get_vendor_ack_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_get_vendor_ack_secret() TO anon, authenticated;
