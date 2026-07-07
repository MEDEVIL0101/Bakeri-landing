-- Diagnostic: notify_vendor_application() never actually called net.http_post
-- for today's test inserts (net._http_response has no rows since June 17),
-- which means the vault.decrypted_secrets lookup for 'bakeri_webhook_secret'
-- silently returned NULL. Check whether that secret name exists at all.

CREATE OR REPLACE FUNCTION public.debug_vault_secret_names()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_names jsonb;
  v_err   text;
BEGIN
  BEGIN
    SELECT jsonb_agg(name) INTO v_names FROM vault.decrypted_secrets;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  RETURN jsonb_build_object('names', v_names, 'error', v_err);
END;
$$;

REVOKE ALL ON FUNCTION public.debug_vault_secret_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_vault_secret_names() TO anon, authenticated;
