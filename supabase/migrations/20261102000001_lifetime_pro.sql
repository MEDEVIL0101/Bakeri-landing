-- Lifetime Pro (Harvey 2026-11-02): a complimentary Pro plan set by hand,
-- never by Stripe — first for Sugarland Bakery Co. (testing). It wins over
-- everything else in effective_plan_tier(), so it covers the 0% fee, the
-- app/web plan gate and Pro features; the billing webhook never touches it.
ALTER TABLE public.vendor_plans
    ADD COLUMN IF NOT EXISTS lifetime_pro BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.effective_plan_tier(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select coalesce((
    select case
      when vp.lifetime_pro then 'pro'
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

-- Sugarland Bakery Co. (hmtnframingco@gmail.com)
INSERT INTO public.vendor_plans (user_id, lifetime_pro)
VALUES ('238e00cd-6b32-456d-86b1-8db390f4dcfc', TRUE)
ON CONFLICT (user_id) DO UPDATE SET lifetime_pro = TRUE, updated_at = now();
