-- Plan sales (Harvey 2026-11-13): a site-wide sale on monthly plans, e.g.
-- Black Friday = 50% off the first 3 months. Switched on/off in Bakeri Admin
-- (Website → Plan sale) or here. While a sale is live:
--   · create-plan-checkout applies its Stripe coupon to new monthly subscriptions
--     (ahead of the referral 10% — Stripe Checkout takes one discount);
--   · the plan + trial pages show the sale price, and the homepage hero shows the offer.
-- At most one sale is live at a time; the newest live one wins.

CREATE TABLE IF NOT EXISTS public.plan_sales (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL,              -- "Black Friday"
  percent_off      INT  NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  months           INT  NOT NULL CHECK (months BETWEEN 1 AND 24),
  stripe_coupon_id TEXT NOT NULL,              -- live coupon, percent_off / repeating / months to match
  active           BOOLEAN NOT NULL DEFAULT false,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_sales ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.active_plan_sale()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', id, 'label', label, 'percent_off', percent_off, 'months', months, 'ends_at', ends_at)
  FROM public.plan_sales
  WHERE active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.active_plan_sale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_plan_sale() TO anon, authenticated, service_role;

-- Off until Harvey switches it on; runs to the end of Cyber Monday (Dec 1, Eastern).
INSERT INTO public.plan_sales (id, label, percent_off, months, stripe_coupon_id, active, ends_at)
VALUES ('black-friday-2026', 'Black Friday', 50, 3, 'BLACKFRIDAY50', false, '2026-12-02 05:00:00+00')
ON CONFLICT (id) DO NOTHING;
