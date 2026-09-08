-- Schedules the monthly release-referral-payouts sweep via pg_cron + pg_net
-- (both already enabled — see 20260713000004_schedule_baker_payouts.sql).
--
-- Runs 09:00 UTC on the 1st of every month. It pays each referrer one Stripe
-- transfer covering every referral earning that has cleared its 14-day hold
-- and whose referred baker has passed the CAD $100 completed-sales threshold,
-- netted against any post-payout reversal. A referrer whose net is <= 0 is
-- skipped and rolls forward to the next month.
--
-- Webhook secret comes from Vault (name: bakeri_webhook_secret) — the same
-- entry the baker-payout and vendor-invite crons use. Never hardcode it in
-- migration SQL (it gets committed to git — see the July 2026 leak in
-- 20260713000004's header).

SELECT cron.schedule(
    'release-referral-payouts',
    '0 9 1 * *',  -- 09:00 UTC, 1st of each month
    $$
    SELECT net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/release-referral-payouts',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
        ),
        body := '{}'::jsonb
    );
    $$
);
