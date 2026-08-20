-- Auto-decline overdue guest (web, no-account) marketplace orders the
-- baker never acted on: 15 minutes for ready_now, 24 hours for pre-order
-- (scheduled_pickup_date IS NOT NULL). The actual refund + email is handled
-- by refund-and-notify-guest-order-declined, triggered off the
-- marketplace_status = 'declined' write this makes — see
-- 20260714000009_web_checkout.sql's trigger extension. This function does
-- nothing but the atomic status flip.
--
-- Mirrors 20260713000004_schedule_baker_payouts.sql exactly: pg_cron +
-- pg_net, webhook secret from Vault, never hardcoded (see that migration's
-- comment for why — a real past leak incident).

select cron.schedule(
    'expire-overdue-guest-orders',
    '*/5 * * * *', -- every 5 minutes
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/expire-overdue-guest-orders',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
