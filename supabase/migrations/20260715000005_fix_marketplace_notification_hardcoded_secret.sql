-- send_marketplace_notification has hardcoded a literal x-webhook-secret
-- value since it was first written (20260524000003), most recently updated
-- by 20260712000016 — but that literal doesn't match the currently-live
-- BAKERI_WEBHOOK_SECRET (confirmed by comparing against
-- vault.decrypted_secrets directly), meaning every push notification this
-- function sends has likely been silently failing notify-marketplace's own
-- webhook-secret check this whole time. It was also flagged by GitGuardian
-- as an exposed secret after a recent migration touched this function and
-- re-committed the same literal — harmless in this case since the value was
-- already stale/non-matching, but the hardcoding itself is the real bug.
-- Switching to the same Vault-sourced pattern already used by
-- call_guest_order_webhook eliminates this whole class of problem going
-- forward: rotating BAKERI_WEBHOOK_SECRET updates Vault once, and every
-- caller picks it up automatically instead of needing a matching code change.

CREATE OR REPLACE FUNCTION send_marketplace_notification(
  p_recipient_user_id   UUID,
  p_title               TEXT,
  p_body                TEXT,
  p_data                JSONB         DEFAULT '{}',
  p_recipient_user_id_2 UUID          DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';
BEGIN
  PERFORM net.http_post(
    url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/notify-marketplace',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'apikey',             v_anon_key,
      'Authorization',      'Bearer ' || v_anon_key,
      'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
    ),
    body    := jsonb_build_object(
      'recipient_user_id',   p_recipient_user_id,
      'recipient_user_id_2', p_recipient_user_id_2,
      'title',               p_title,
      'body',                p_body,
      'data',                p_data
    )
  );
END;
$$;
