-- Vendor plans, billed on the web only through Stripe Billing on Bakeri's
-- own (platform) Stripe account — never Apple in-app purchase.
--
-- Tiers (Harvey 2026-10-23): a free trial, then
--   starter — $5.99/mo + 5% Bakeri fee per sale
--   pro     — $19.99/mo, no Bakeri fee
-- (Stripe card fees are the vendor's on both.) The trial runs on the plan
-- the vendor picks — a Stripe subscription in 'trialing' — once per vendor.
--
-- One row per vendor. Written only by service-role edge functions
-- (stripe-billing-webhook, create-plan-checkout). Vendors read their own row;
-- the apps and storefront use effective_plan_tier().
--
-- Accounts that exist before this migration are grandfathered (Harvey
-- 2026-10-23): Starter free forever — today's deal, 5% fee, no monthly
-- charge, never sent to the plan picker. They can still subscribe to Pro to
-- drop the fee; if that subscription ends they fall back to free Starter,
-- because grandfathered_starter is never cleared by the webhook.

create table if not exists public.vendor_plans (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  -- The Stripe subscription's tier; 'none' = no live subscription.
  tier                   text not null default 'none' check (tier in ('none', 'starter', 'pro')),
  -- Stripe subscription status ('trialing', 'active', 'past_due',
  -- 'canceled', 'incomplete', 'unpaid', …), or 'none' before any subscription.
  status                 text not null default 'none',
  billing_interval       text check (billing_interval in ('month', 'year')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  -- Set once the vendor has had their free trial; later subscriptions start paid.
  trial_used_at          timestamptz,
  cancel_at_period_end   boolean not null default false,
  -- Free Starter forever (accounts from before plans).
  grandfathered_starter  boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.vendor_plans enable row level security;

drop policy if exists "vendor_plans_select_own" on public.vendor_plans;
create policy "vendor_plans_select_own" on public.vendor_plans
  for select to authenticated using (user_id = auth.uid());

-- No insert/update/delete policies: clients can't write plans directly.
revoke insert, update, delete on public.vendor_plans from anon, authenticated;
grant select on public.vendor_plans to authenticated;

insert into public.vendor_plans (user_id, grandfathered_starter)
select p.id, true
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do nothing;

-- The tier a vendor actually has right now, or 'none': a live
-- subscription's tier, else free Starter if grandfathered. A paid plan counts
-- while Stripe is still trying to collect (past_due) — Stripe's retries and
-- dunning emails decide when it lapses, and the webhook then records
-- canceled/unpaid.
create or replace function public.effective_plan_tier(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when vp.tier <> 'none' and vp.status in ('trialing', 'active', 'past_due') then vp.tier
      when vp.grandfathered_starter then 'starter'
      else 'none' end
    from public.vendor_plans vp where vp.user_id = p_user_id
  ), 'none');
$$;

revoke all on function public.effective_plan_tier(uuid) from public;
grant execute on function public.effective_plan_tier(uuid) to anon, authenticated, service_role;
