-- Clean up the remaining temporary diagnostic RPCs used to debug why
-- notify_vendor_application() wasn't sending email (root causes found and
-- fixed: 1. vault.decrypted_secrets had no 'bakeri_webhook_secret' entry —
-- switched to a dedicated 'vendor_ack_webhook_secret'; 2. the edge function
-- was deployed with JWT verification on, so Supabase's gateway rejected the
-- trigger's request before it reached our own secret check — redeployed
-- with --no-verify-jwt). Nothing here should stay reachable by anon.

DROP FUNCTION IF EXISTS public.debug_net_responses();
DROP FUNCTION IF EXISTS public.debug_vault_secret_names();
