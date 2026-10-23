// Vendor plans as the web app shows them. Server-side source of truth (Stripe
// prices, fee rates) is supabase/functions/_shared/plans.ts — keep the fee
// numbers here in step with PLAN_FEE_RATE there.
//
// Tiers (Harvey 2026-10-23): a free trial on the plan they pick, then
// Starter $5.99/mo + 5% Bakeri fee per sale, or Pro $19.99/mo with no Bakeri
// fee; Stripe card fees are the vendor's on both. TRIAL_DAYS must match the
// PLAN_TRIAL_DAYS secret (14). Plans are bought here on the web
// only — the iOS app never shows prices or links to buy (App Store
// anti-steering rules).

import { callFunction } from './api';
import { supabase } from './supabase';

export type PlanTier = 'starter' | 'pro';
export type BillingInterval = 'month' | 'year';

export interface VendorPlan {
  tier: PlanTier | 'none';
  status: string;
  billing_interval: BillingInterval | null;
  current_period_end: string | null;
  trial_end: string | null;
  trial_used_at: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  grandfathered_starter: boolean;
}

export interface PlanDef {
  tier: PlanTier;
  name: string;
  blurb: string;
  /** CAD per month. */
  price: number;
  feePct: number;
  perks: string[];
}

export const PLANS: PlanDef[] = [
  { tier: 'starter', name: 'Starter', blurb: 'A low monthly price while you’re getting going.', price: 5.99, feePct: 5,
    perks: ['Your storefront at bakeriapp.com', 'Orders, schedule, menu and recipes', 'Card payments and payouts', 'iPhone app and web app'] },
  { tier: 'pro', name: 'Pro', blurb: 'Keep every dollar of your sales.', price: 19.99, feePct: 0,
    perks: ['Everything in Starter', 'No Bakeri fee on any sale', 'Best value once you sell about $280 a month'] },
];

export const TRIAL_DAYS = 14;

/** One line for Settings: "Pro · trial ends Nov 22" etc. */
export function planSummary(plan: VendorPlan | null | undefined): string {
  const tier = effectiveTier(plan);
  if (tier === 'none' || !plan) return 'Choose a plan';
  const name = PLANS.find((p) => p.tier === tier)?.name ?? tier;
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  if (!hasSubscription(plan)) return `${name} · free for you, forever`;
  if (plan.status === 'trialing' && plan.trial_end) return `${name} · free trial until ${date(plan.trial_end)}`;
  if (plan.status === 'past_due') return `${name} · payment failed — update your card`;
  if (plan.cancel_at_period_end && plan.current_period_end) return `${name} · ends ${date(plan.current_period_end)}`;
  return `${name} plan`;
}

export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/Vbvma852';

const LIVE = ['trialing', 'active', 'past_due'];

/** A live Stripe subscription (trial included). */
export function hasSubscription(plan: VendorPlan | null | undefined): boolean {
  return !!plan && plan.tier !== 'none' && LIVE.includes(plan.status);
}

/** The tier the vendor actually has now, or 'none' (mirrors SQL effective_plan_tier). */
export function effectiveTier(plan: VendorPlan | null | undefined): PlanTier | 'none' {
  if (plan && hasSubscription(plan)) return plan.tier as PlanTier;
  return plan?.grandfathered_starter ? 'starter' : 'none';
}

/**
 * The signed-in vendor's plan row. null = no row yet (never subscribed);
 * undefined = couldn't tell (e.g. the table isn't there yet) — callers
 * must not block the vendor on that.
 */
export async function loadPlan(userId: string): Promise<VendorPlan | null | undefined> {
  const { data, error } = await supabase.from('vendor_plans')
    .select('tier, status, billing_interval, current_period_end, trial_end, trial_used_at, cancel_at_period_end, stripe_customer_id, grandfathered_starter')
    .eq('user_id', userId).maybeSingle();
  if (error) return undefined;
  return (data as VendorPlan | null) ?? null;
}

/** Starts Stripe Checkout (or opens the billing portal for an existing subscriber) and leaves the page. */
export async function startCheckout(tier: PlanTier, interval: BillingInterval): Promise<void> {
  const { url } = await callFunction<{ url: string }>('create-plan-checkout', { tier, interval });
  window.location.assign(url);
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await callFunction<{ url: string }>('create-billing-portal-session', {});
  window.location.assign(url);
}
