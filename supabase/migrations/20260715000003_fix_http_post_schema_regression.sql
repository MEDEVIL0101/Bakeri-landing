-- 20260524000004 already fixed this exact bug once: pg_net installs
-- http_post into the `net` schema, not `extensions`. 20260712000016 (a
-- webhook-secret rotation) accidentally reverted send_marketplace_notification
-- back to extensions.http_post while copy-pasting the function body forward.
-- Since PERFORM of a nonexistent function raises a hard error (not a silent
-- pg_net failure), this has been aborting the ENTIRE orders insert/update
-- transaction for every marketplace order — not just push notifications —
-- since 2026-07-12. This also fixes the same mistake freshly introduced in
-- today's call_guest_order_webhook (20260714000009_web_checkout.sql), which
-- was copy-pasted from the already-broken version.

CREATE OR REPLACE FUNCTION send_marketplace_notification(
  p_recipient_user_id   UUID,
  p_title               TEXT,
  p_body                TEXT,
  p_data                JSONB         DEFAULT '{}',
  p_recipient_user_id_2 UUID          DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/notify-marketplace',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  'fd5f5fb0b8bd7dbe6bc0aca6a11a2e8247b4f9a63845f0cb00935a39339eae44'
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

CREATE OR REPLACE FUNCTION public.call_guest_order_webhook(
    p_function_name TEXT,
    p_order_id      UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM net.http_post(
        url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/' || p_function_name,
        headers := jsonb_build_object(
            'Content-Type',      'application/json',
            'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
        ),
        body    := jsonb_build_object('order_id', p_order_id)
    );
END;
$$;
