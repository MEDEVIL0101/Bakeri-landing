-- Schedules the hourly release-baker-payouts sweep via pg_cron + pg_net
-- (both already enabled on this project — see cleanup-unconfirmed-users
-- for the existing precedent, though that job runs pure SQL rather than
-- calling an edge function).
--
-- NOT enabled by a blanket migration push without sign-off: this is the
-- job that actually moves money out of Bakeri's Stripe balance into baker
-- accounts, unattended, on a schedule. Confirm release-baker-payouts has
-- been smoke-tested against a real completed order before this runs live.

select cron.schedule(
    'release-baker-payouts',
    '0 * * * *', -- hourly
    $$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/release-baker-payouts',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', '***REMOVED-LEAKED-SECRET***'
        ),
        body := '{}'::jsonb
    );
    $$
);
