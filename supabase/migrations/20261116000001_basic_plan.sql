-- Basic plan (Harvey 2026-11-15): $3/mo, no Bakeri fee. A custom-orders-only
-- storefront with web links — Bakesy Standard for $3. Menu checkout,
-- products, digital goods, courses, clubs, tips, lead magnets and campaigns
-- need Starter or Pro. effective_plan_tier() already returns vendor_plans.tier
-- for a live subscription, so 'basic' flows through it unchanged; this only
-- widens the tier checks.

ALTER TABLE public.vendor_plans DROP CONSTRAINT IF EXISTS vendor_plans_tier_check;
ALTER TABLE public.vendor_plans
    ADD CONSTRAINT vendor_plans_tier_check CHECK (tier IN ('none', 'basic', 'starter', 'pro'));

ALTER TABLE public.plan_promo_codes DROP CONSTRAINT IF EXISTS plan_promo_codes_tier_check;
ALTER TABLE public.plan_promo_codes
    ADD CONSTRAINT plan_promo_codes_tier_check CHECK (tier IN ('basic', 'starter', 'pro'));

ALTER TABLE public.vendor_plans DROP CONSTRAINT IF EXISTS vendor_plans_custom_coupon_tier_check;
ALTER TABLE public.vendor_plans
    ADD CONSTRAINT vendor_plans_custom_coupon_tier_check CHECK (custom_coupon_tier IN ('basic', 'starter', 'pro'));
