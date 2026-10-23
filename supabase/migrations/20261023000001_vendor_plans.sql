-- Paid vendor plans, billed on the web only through Stripe Billing on
-- Bakeri's own (platform) Stripe account — never Apple in-app purchase.
--
-- One row per vendor. Written only by service-role edge functions
-- (stripe-billing-webhook, create-plan-checkout) — except picking Free,
-- which goes through choose_free_plan() below. Vendors can read their own
-- row; the apps and storefront read the plan through effective_plan_tier().
--
-- chosen_at is null until the vendor has picked a plan (Free or paid) on
-- the web sign-up flow; the web app sends them to the plan picker until it
-- is set. Every account that exists before this migration is backfilled as
-- Free + chosen, so nobody already using Bakeri is interrupted.

create table if not exists public.vendor_plans (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  tier                   text not null default 'free' check (tier in ('free', 'pro', 'business')),
  -- Stripe subscription status ('active', 'trialing', 'past_due',
  -- 'canceled', 'incomplete', 'unpaid', …); 'active' for Free.
  status                 text not null default 'active',
  billing_interval       text check (billing_interval in ('month', 'year')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  chosen_at              timestamptz,
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

insert into public.vendor_plans (user_id, tier, status, chosen_at)
select p.id, 'free', 'active', now()
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do nothing;

-- The tier a vendor actually gets right now. A paid plan counts while
-- Stripe is still trying to collect (past_due) — Stripe's own retries and
-- dunning emails decide when it lapses, and the webhook then marks it
-- canceled/unpaid, which drops the vendor to Free.
create or replace function public.effective_plan_tier(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when vp.tier <> 'free' and vp.status in ('active', 'trialing', 'past_due') then vp.tier else 'free' end
    from public.vendor_plans vp where vp.user_id = p_user_id
  ), 'free');
$$;

revoke all on function public.effective_plan_tier(uuid) from public;
grant execute on function public.effective_plan_tier(uuid) to anon, authenticated, service_role;

-- Picking Free on the plan picker. Never downgrades a live paid
-- subscription — that happens in the Stripe billing portal, and the
-- webhook records it.
create or replace function public.choose_free_plan()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into public.vendor_plans (user_id, tier, status, chosen_at)
  values (auth.uid(), 'free', 'active', now())
  on conflict (user_id) do update
    set chosen_at = coalesce(public.vendor_plans.chosen_at, now()),
        updated_at = now()
    where public.vendor_plans.tier = 'free'
       or public.vendor_plans.status not in ('active', 'trialing', 'past_due');
end;
$$;

revoke all on function public.choose_free_plan() from public;
grant execute on function public.choose_free_plan() to authenticated;
