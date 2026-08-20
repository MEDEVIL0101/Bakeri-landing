-- Keeps Supabase's platform-level JWT verification ON for the three new
-- webhook-secret-gated functions (send-guest-order-confirmed-email,
-- refund-and-notify-guest-order-declined, expire-overdue-guest-orders) —
-- rather than deploying them with --no-verify-jwt, add the public anon key
-- as Authorization/apikey headers to the two server-side callers (the
-- trigger and the cron job). This satisfies the platform gate the same way
-- every public web page already does; the real access control for these
-- functions remains their own x-webhook-secret check, unchanged.
--
-- The anon key is meant to be public (it's already embedded in
-- baker/index.html, custom-order.html, pay/index.html) — safe to inline
-- here, unlike BAKERI_WEBHOOK_SECRET.

CREATE OR REPLACE FUNCTION public.call_guest_order_webhook(
    p_function_name TEXT,
    p_order_id      UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';
BEGIN
    PERFORM extensions.http_post(
        url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/' || p_function_name,
        headers := jsonb_build_object(
            'Content-Type',      'application/json',
            'apikey',            v_anon_key,
            'Authorization',     'Bearer ' || v_anon_key,
            'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
        ),
        body    := jsonb_build_object('order_id', p_order_id)::TEXT
    );
END;
$$;

-- Re-registering with the same job name updates the existing cron.schedule
-- entry from 20260714000010_expire_guest_orders_cron.sql in place.
select cron.schedule(
    'expire-overdue-guest-orders',
    '*/5 * * * *',
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/expire-overdue-guest-orders',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
