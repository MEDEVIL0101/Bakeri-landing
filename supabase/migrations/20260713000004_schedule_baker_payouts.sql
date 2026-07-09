-- Schedules the hourly release-baker-payouts sweep via pg_cron + pg_net
-- (both already enabled on this project — see cleanup-unconfirmed-users
-- for the existing precedent, though that job runs pure SQL rather than
-- calling an edge function).
--
-- The webhook secret is pulled from Vault (name: bakeri_webhook_secret) —
-- matching the pattern already used by confirm_pickup and
-- notify_vendor_application — never hardcode it directly in migration SQL,
-- that gets committed to git. (An earlier version of this migration did
-- exactly that and leaked BAKERI_WEBHOOK_SECRET publicly; the secret has
-- since been rotated and this file corrected — see project memory.)
--
-- Create the vault entry once, out of band, before applying this migration:
--   select vault.create_secret('<value>', 'bakeri_webhook_secret', 'Shared secret for internal edge function webhook calls');

select cron.schedule(
    'release-baker-payouts',
    '0 * * * *', -- hourly
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/release-baker-payouts',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
