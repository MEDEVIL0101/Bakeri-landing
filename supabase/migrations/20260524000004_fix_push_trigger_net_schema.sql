-- Fix send_marketplace_notification: use net.http_post (pg_net schema) not extensions.http_post.
-- The previous migration used the wrong schema, causing every marketplace order INSERT to fail.

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
      'Content-Type',     'application/json',
      'x-webhook-secret', 'fe1b0c413957b3fbe6a28f083d41a6dfcc065349f2017e668d8c46422ffcf1ca'
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
