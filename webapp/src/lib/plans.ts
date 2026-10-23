// Vendor plans as the web app shows them. Server-side source of truth (Stripe
// prices, fee rates) is supabase/functions/_shared/plans.ts — keep the fee
// numbers here in step with PLAN_FEE_RATE there.
//
// PLACEHOLDER tiers/prices (2026-10-23) until Harvey and Diana settle them.
// Plans are bought here on the web only — the iOS app never shows prices or
// links to buy (App Store anti-steering rules).

import { callFunction } from './api';
import { supabase } from './supabase';

export type PlanTier = 'free' | 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

export interface VendorPlan {
  tier: PlanTier;
  status: string;
  billing_interval: BillingInterval | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  chosen_at: string | null;
}

export interface PlanDef {
  tier: PlanTier;
  name: string;
  blurb: string;
  /** Whole dollars (CAD). */
  price: { month: number; year: number };
  feePct: number;
  perks: string[];
}

export const PLANS: PlanDef[] = [
  { tier: 'free', name: 'Free', blurb: 'Everything you need to start selling.', price: { month: 0, year: 0 }, feePct: 5,
    perks: ['Your storefront at bakeriapp.com', 'Orders, schedule, menu and recipes', 'Card payments and payouts', 'Themes and backgrounds'] },
  { tier: 'pro', name: 'Pro', blurb: 'Lower fees and a storefront that’s all yours.', price: { month: 12, year: 120 }, feePct: 2,
    perks: ['Everything in Free', 'Custom fonts, title effects and photo backgrounds', 'No “Made with Bakeri” footer', 'Email campaigns and promotions'] },
  { tier: 'business', name: 'Business', blurb: 'No Bakeri fee on your sales.', price: { month: 29, year: 290 }, feePct: 0,
    perks: ['Everything in Pro', 'Tap to Pay in person', 'Finance exports', 'Priority support'] },
];

export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/Vbvma852';

const LIVE = ['active', 'trialing', 'past_due'];

/** The tier the vendor actually has now (mirrors SQL effective_plan_tier). */
export function effectiveTier(plan: VendorPlan | null | undefined): PlanTier {
  return plan && plan.tier !== 'free' && LIVE.includes(plan.status) ? plan.tier : 'free';
}

/**
 * The signed-in vendor's plan row. null = no row yet (hasn't picked);
 * undefined = couldn't tell (e.g. the table isn't there yet) — callers
 * must not block the vendor on that.
 */
export async function loadPlan(userId: string): Promise<VendorPlan | null | undefined> {
  const { data, error } = await supabase.from('vendor_plans')
    .select('tier, status, billing_interval, current_period_end, cancel_at_period_end, stripe_customer_id, chosen_at')
    .eq('user_id', userId).maybeSingle();
  if (error) return undefined;
  return (data as VendorPlan | null) ?? null;
}

export async function chooseFreePlan(): Promise<void> {
  const { error } = await supabase.rpc('choose_free_plan');
  if (error) throw new Error(error.message);
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
