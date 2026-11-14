-- One-off plan deals for individual vendors (Harvey 2026-11-14: Makayla /
-- Aerabella's Cookies gets 30% off Pro for life as an early user). When set,
-- create-plan-checkout applies this Stripe coupon to that tier's checkout in
-- place of any sale, referral or launch coupon.
ALTER TABLE public.vendor_plans
    ADD COLUMN IF NOT EXISTS custom_coupon_id   TEXT,
    ADD COLUMN IF NOT EXISTS custom_coupon_tier TEXT CHECK (custom_coupon_tier IN ('starter', 'pro'));

UPDATE public.vendor_plans
SET custom_coupon_id = 'ARABELLA_PRO30', custom_coupon_tier = 'pro', updated_at = now()
WHERE user_id = '898c94c9-fd89-4258-8c2a-4360b81a1992';
