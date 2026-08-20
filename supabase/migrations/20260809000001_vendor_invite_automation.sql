-- Automates the previously-manual "check vendor_applications for new
-- pending rows, send the access-approved email, log it, mark contacted"
-- workflow. Runs every minute; process-pending-vendor-invites itself only
-- ever acts on rows older than 5 minutes (the delay the baker asked for
-- before an applicant gets full app access automatically, with no other
-- review step) — so real-world latency is 5-6 minutes, not instant.
--
-- Reuses the existing shared 'bakeri_webhook_secret' Vault entry (same one
-- expire-overdue-guest-orders already uses) rather than a new dedicated
-- secret — this function has no legitimate external caller to isolate
-- from, unlike send-vendor-ack-email's dedicated secret, which exists
-- because that trigger fires from a client-facing INSERT path.

select cron.schedule(
    'process-pending-vendor-invites',
    '* * * * *',
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/process-pending-vendor-invites',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
