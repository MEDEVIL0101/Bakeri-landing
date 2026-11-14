-- Referral codes stack on a plan sale (Harvey 2026-11-13): Black Friday 50% +
-- the referral 10% = 60% off the first 3 months. Stripe Checkout takes one
-- discount, so the combination is its own coupon.

ALTER TABLE public.plan_sales
  ADD COLUMN IF NOT EXISTS referral_percent_off INT CHECK (referral_percent_off BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS stripe_referral_coupon_id TEXT;

UPDATE public.plan_sales
SET referral_percent_off = 60, stripe_referral_coupon_id = 'BLACKFRIDAY60REF'
WHERE id = 'black-friday-2026';

CREATE OR REPLACE FUNCTION public.active_plan_sale()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', id, 'label', label, 'percent_off', percent_off, 'months', months, 'ends_at', ends_at,
                            'referral_percent_off', referral_percent_off)
  FROM public.plan_sales
  WHERE active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY created_at DESC
  LIMIT 1;
$$;
