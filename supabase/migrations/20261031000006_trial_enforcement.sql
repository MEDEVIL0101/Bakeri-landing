-- Enforcing the 7-day free trial (Harvey 2026-10-31).
--   * One trial per card, not just per account: stripe-billing-webhook stores
--     the card's Stripe fingerprint and ends a second trial on the same card
--     straight away (it's charged then).
--   * A failed charge doesn't keep the shop open for Stripe's whole retry
--     schedule: past_due counts as a live plan for 3 days when the plan has
--     never been paid (the charge when the trial ends), 7 days for a renewal.

ALTER TABLE public.vendor_plans
    ADD COLUMN IF NOT EXISTS trial_card_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS vendor_plans_trial_card ON public.vendor_plans (trial_card_fingerprint)
    WHERE trial_card_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.effective_plan_tier(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select coalesce((
    select case
      when vp.tier <> 'none' and (
             vp.status in ('trialing', 'active')
          or (vp.status = 'past_due' and (
                vp.past_due_since is null
             or now() < vp.past_due_since + case when vp.first_paid_at is null then interval '3 days' else interval '7 days' end)))
        then vp.tier
      when vp.grandfathered_starter then 'starter'
      else 'none' end
    from public.vendor_plans vp where vp.user_id = p_user_id
  ), 'none');
$$;
