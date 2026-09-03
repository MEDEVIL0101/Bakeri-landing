-- Stripe Connect Express -> Standard: THE CUTOVER RESET.
--
-- ⚠️  RUN THIS BY HAND, not via `supabase db push`. It is deliberately NOT in
--     supabase/migrations/ so it doesn't fire the moment someone deploys.
--
-- Prerequisites (all must be true before running):
--   1. Deployed: 20260901000001_stripe_standard_accounts.sql
--   2. Deployed: create-connect-account-link (type:"standard"),
--      get-baker-payout-summary, stripe-connect-webhook, and
--      `trigger-baker-payout` removed.
--   3. Shipped: the app build with the payout button removed / copy updated
--      (or accepted that old builds show a harmless dead button until update).
--   4. Sent: the baker migration email (send-connect-migration-email).
--   5. Cookiesbysteph's available balance paid out (one-off ops script) and
--      no baker has a captured-but-not-completed order in flight
--      (SELECT id,user_id,payment_status,marketplace_status FROM orders
--       WHERE payment_status IN ('captured','pending','authorized')
--         AND marketplace_status NOT IN ('completed','delivered','cancelled')
--         AND payment_model = 'direct';  -> expect 0 rows, or finalize them
--       manually against the OLD account id first).
--
-- Effect: every existing baker's checkout goes dark immediately (storefront
-- `stripeReady` flips false, every create-*-payment-intent refuses) until they
-- reconnect via "Connect with Stripe", which now builds a Standard account.
-- The old Express account id is preserved in stripe_connect_express_account_id_legacy
-- so refunds/disputes on already-completed orders can still be actioned and the
-- account can be closed later.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_connect_express_account_id_legacy TEXT;

UPDATE public.profiles
   SET stripe_connect_express_account_id_legacy = stripe_connect_account_id,
       stripe_connect_account_id                = NULL,
       stripe_connect_onboarding_complete       = false,
       stripe_connect_account_type              = 'standard'
 WHERE stripe_connect_account_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.stripe_connect_express_account_id_legacy IS
  'The baker''s pre-migration Express account id, kept after the cutover reset nulled stripe_connect_account_id. Needed to action refunds/disputes on Express-era orders and to close the old account once it is past its last order''s ~120-day dispute window.';

-- Sanity check — every previously-connected baker is now reset and typed standard.
-- SELECT count(*) FILTER (WHERE stripe_connect_account_id IS NOT NULL)  AS still_connected,
--        count(*) FILTER (WHERE stripe_connect_express_account_id_legacy IS NOT NULL) AS have_legacy_id
--   FROM public.profiles;

COMMIT;
