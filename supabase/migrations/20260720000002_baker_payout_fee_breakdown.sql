-- Audit trail for release-baker-payouts's new fee math: the baker's cut is
-- now amount_received minus the platform fee minus Stripe's real per-charge
-- fee (read from the charge's balance_transaction), instead of the platform
-- silently absorbing 100% of Stripe's fee out of its own 5%. Recording the
-- exact cents deducted per order makes that math auditable/reportable rather
-- than only visible in Stripe's dashboard.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_fee_cents    INTEGER,
  ADD COLUMN IF NOT EXISTS baker_payout_cents  INTEGER;

COMMENT ON COLUMN public.orders.platform_fee_cents IS 'Bakeri''s platform fee retained on this order''s payout, in cents.';
COMMENT ON COLUMN public.orders.stripe_fee_cents    IS 'Stripe''s actual processing fee on this order''s charge, in cents, deducted from the baker''s payout.';
COMMENT ON COLUMN public.orders.baker_payout_cents  IS 'Amount actually transferred to the baker for this order, in cents (amount_received - platform_fee_cents - stripe_fee_cents).';
