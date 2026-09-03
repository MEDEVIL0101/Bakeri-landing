-- Stripe Connect: Express -> Standard connected accounts.
--
-- Bakeri stopped custodying funds in the 2026-07-30 direct-charge migration
-- (see 20260730000001_payment_model_column.sql). Express accounts carried over
-- from the pre-custody architecture and kept billing the platform ~CA$2/mo per
-- active account + 0.25% volume + per-payout fees, and left the platform as the
-- negative-balance backstop for every baker. Standard accounts + direct charges
-- + application_fee_amount keep Bakeri's cut identical while dropping all of
-- that: the baker is a full independent Stripe customer who owns their
-- dashboard, payout schedule, and dispute/loss liability.
--
-- Tap to Pay (Stripe Terminal for Connect) needs Express/Custom and is paused
-- until it's revisited as a separate project — see STRIPE_STANDARD_MIGRATION_PLAN.md.

-- ── profiles.stripe_connect_account_type ──────────────────────────────────────
-- Lets the fleet be mixed while existing bakers reconnect, and lets code branch
-- where behaviour differs (Express login links, Terminal, payout control).
-- New rows default to 'standard'; every account that exists today was created
-- as Express, so backfill those explicitly.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_connect_account_type TEXT NOT NULL DEFAULT 'standard'
        CHECK (stripe_connect_account_type IN ('express', 'standard'));

UPDATE public.profiles
   SET stripe_connect_account_type = 'express'
 WHERE stripe_connect_account_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.stripe_connect_account_type IS
  'Which Stripe Connect account model backs this baker: standard (baker owns the account, no platform fees or loss liability, no platform-controlled payouts/Terminal) or express (legacy — platform-managed, platform-billed, platform is loss backstop). New accounts are standard. Existing accounts stay express until the baker reconnects.';

-- Note: an earlier draft of this migration also added per-order
-- stripe_connect_account_id snapshot columns to harden the finalize-* funcs
-- against a baker reconnecting mid-checkout. That's deferred — the cutover
-- reset sets stripe_connect_onboarding_complete = false, which disables every
-- storefront's checkout for the whole reconnect window, so no new order can be
-- created against a mismatched account. The snapshot hardening is still worth
-- doing for the general "Start over" disconnect button; tracked in
-- STRIPE_STANDARD_MIGRATION_PLAN.md.
