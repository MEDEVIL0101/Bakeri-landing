-- Periodic Stripe Connect health sweep — see check-stripe-connect-health's
-- own header comment for why this exists (Sweet Southern Bakery incident:
-- an orphaned Connect account went undetected until a real customer's
-- payment failed). Mirrors 20260714000010_expire_guest_orders_cron.sql's
-- pg_cron + pg_net + Vault-secret pattern exactly.

select cron.schedule(
    'check-stripe-connect-health',
    '*/30 * * * *', -- every 30 minutes
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/check-stripe-connect-health',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
