-- Introduces a two-model payment system: 'direct' (Stripe Connect direct
-- charge, application_fee_amount deducted on the baker's own connected
-- account, funds settle instantly) vs 'platform_custody' (today's model —
-- charge lands in Bakeri's own balance, release-baker-payouts sweeps a
-- Transfer out later). 'direct' is used for every single-baker order (the
-- only case reachable today — each baker has their own storefront URL).
-- 'platform_custody' stays the model for multi-baker orders, dormant until
-- the cross-baker marketplace reopens, at which point Bakeri needs custody
-- of those funds to manage cross-baker disputes/returns.
--
-- release-baker-payouts' sweep queries are updated (in the same change) to
-- require payment_model = 'platform_custody', so a 'direct' order — already
-- settled to the baker at charge time — is never re-processed by the sweep.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_model TEXT NOT NULL DEFAULT 'platform_custody'
    CHECK (payment_model IN ('platform_custody', 'direct'));

COMMENT ON COLUMN public.orders.payment_model IS
  'Which Stripe money-flow model settled this order: platform_custody (charged into Bakeri''s balance, swept to baker later by release-baker-payouts) or direct (Stripe Connect direct charge on the baker''s own account, settled instantly, application_fee_amount is Bakeri''s cut). Default platform_custody covers legacy orders and multi-baker orders (dormant until the cross-baker marketplace reopens).';
