-- Plan promo codes (Harvey 2026-11-10): a sign-up incentive that lengthens the
-- free trial on one plan, e.g. BAKEPRO14HM = 14 days free on Pro. Shared like a
-- referral link (bakeriapp.com/app/plan/trial?tier=pro&ref=BAKEPRO14HM) or typed as
-- the sign-up code; it rides in user_metadata.referral_code, and
-- create-plan-checkout swaps the usual trial for this one when the vendor
-- picks the matching plan. Only a first trial — never for anyone who's had one.
-- Add / switch off codes with SQL; nothing to deploy.

CREATE TABLE IF NOT EXISTS public.plan_promo_codes (
  code        TEXT PRIMARY KEY CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,16}$'),
  tier        TEXT NOT NULL CHECK (tier IN ('starter', 'pro')),
  trial_days  INT  NOT NULL CHECK (trial_days BETWEEN 1 AND 90),
  active      BOOLEAN NOT NULL DEFAULT true,
  expires_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side only (service role); the web reads a code through the RPC below.
ALTER TABLE public.plan_promo_codes ENABLE ROW LEVEL SECURITY;

-- What a code gives, for the sign-up / plan pages to show. Null if it isn't a
-- live promo code (it may still be a referral code).
CREATE OR REPLACE FUNCTION public.resolve_plan_promo(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('code', code, 'tier', tier, 'trial_days', trial_days)
  FROM public.plan_promo_codes
  WHERE code = upper(trim(p_code))
    AND active
    AND (expires_at IS NULL OR expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.resolve_plan_promo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_plan_promo(TEXT) TO anon, authenticated, service_role;

-- Founder-offered codes end in HM (Harvey's initials) — subtle on purpose;
-- the note says so too. The code also lands in Stripe metadata (promo).
INSERT INTO public.plan_promo_codes (code, tier, trial_days, note) VALUES
  ('BAKESTART14HM',    'starter', 14, 'Founder sign-up incentive: 14 days free on Starter'),
  ('BAKEPRO14HM',      'pro',     14, 'Founder sign-up incentive: 14 days free on Pro')
ON CONFLICT (code) DO NOTHING;
