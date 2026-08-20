-- send_marketplace_notification was sending the webhook secret from when
-- trg_marketplace_order_notify was first created (20260524000003), but
-- BAKERI_WEBHOOK_SECRET on the notify-marketplace edge function has since
-- changed — same class of bug as the 2026-04-06 push fix. Because pg_net's
-- http_post is fire-and-forget, the 401 was never surfaced anywhere: quote
-- payments, ready-for-pickup, new messages, etc. have been silently failing
-- to push since whenever the secret drifted. Rotated the secret and updated
-- both sides together (see BAKERI_WEBHOOK_SECRET set via `supabase secrets set`).

CREATE OR REPLACE FUNCTION send_marketplace_notification(
  p_recipient_user_id   UUID,
  p_title               TEXT,
  p_body                TEXT,
  p_data                JSONB         DEFAULT '{}',
  p_recipient_user_id_2 UUID          DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM extensions.http_post(
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
    )::TEXT
  );
END;
$$;
