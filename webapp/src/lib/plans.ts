// Vendor plans as the web app shows them. Server-side source of truth (Stripe
// prices, fee rates) is supabase/functions/_shared/plans.ts — keep the fee
// numbers here in step with PLAN_FEE_RATE there.
//
// Tiers (Harvey 2026-10-30): a free trial on the plan they pick, then
// Starter $10/mo + 5% Bakeri fee per sale (existing vendors are
// grandfathered onto Starter, so they keep paying the 5%), or Pro $30/mo with
// no Bakeri fee; yearly billing is 2 months free ($100 / $300); Stripe card fees are the vendor's on both. TRIAL_DAYS must match the
// PLAN_TRIAL_DAYS secret (7; Harvey 2026-10-30). Plans are bought here on the web
// only — the iOS app never shows prices or links to buy (App Store
// anti-steering rules).

import { trackSite } from './siteTrack';
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
  /** One line under the plan name on the plan picker. */
  tagline: string;
  /** USD per month. */
  price: number;
  /** USD per year when billed yearly — 2 months free (10 × the monthly price). */
  yearPrice: number;
  /** Launch-sale price for the first saleMonths months (Starter only). */
  salePrice?: number;
  saleMonths?: number;
  feePct: number;
  perks: string[];
}

export const PLANS: PlanDef[] = [
  { tier: 'starter', name: 'Starter', tagline: 'Open your shop', blurb: 'A low monthly price while you’re getting going.', price: 10, yearPrice: 100, feePct: 5,
    perks: ['Your storefront at bakeriapp.com', 'Orders, schedule, menu and recipes', 'Card payments and payouts', 'iPhone app and web app'] },
  { tier: 'pro', name: 'Pro', tagline: 'Keep every dollar you make', blurb: 'Keep every dollar of your sales.', price: 30, yearPrice: 300, feePct: 0,
    perks: ['Everything in Starter', 'No Bakeri fee on any sale', 'Email campaigns to your customer list', 'Best value once you sell about $400 a month'] },
];

export const TRIAL_DAYS = 7;
/** Yearly billing = this many months free (shown as "2 months free!"). */
export const YEARLY_FREE_MONTHS = 2;

// The plan a vendor picked on the website before signing up (the site's
// "Try Pro free" button → /app/signup?plan=pro, or "Try Starter free" →
// ?plan=starter, which opens every plan to compare). Kept in this browser and in
// user_metadata.plan_intent, so it survives the confirmation-email round trip
// even when the link opens on another device.
const INTENT_KEY = 'bakeri.planIntent';
export function rememberPlanIntent(tier: string | null): void {
  try { if (tier === 'pro' || tier === 'starter') localStorage.setItem(INTENT_KEY, tier); } catch { /* private mode */ }
}
export function storedPlanIntent(): PlanTier | null {
  try { const t = localStorage.getItem(INTENT_KEY); return t === 'pro' || t === 'starter' ? t : null; } catch { return null; }
}
export function clearPlanIntent(): void {
  try { localStorage.removeItem(INTENT_KEY); } catch { /* private mode */ }
}

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

/** Bakeri's fee on this vendor's storefront sales: none on Pro, 5% otherwise (mirrors _shared/plans.ts PLAN_FEE_RATE). */
export function planFeeRate(plan: VendorPlan | null | undefined): number {
  return effectiveTier(plan) === 'pro' ? 0 : 0.05;
}

/** "5% of each sale" / "nothing on Pro" style copy for the vendor's own plan. */
export function feeDescription(plan: VendorPlan | null | undefined): string {
  return planFeeRate(plan) === 0
    ? 'Your Pro plan has no Bakeri service fee'
    : 'Bakeri’s service fee is 5% of each sale';
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
  trackSite('checkout_start', `${tier}-${interval}`);
  const { url } = await callFunction<{ url: string }>('create-plan-checkout', { tier, interval });
  window.location.assign(url);
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await callFunction<{ url: string }>('create-billing-portal-session', {});
  window.location.assign(url);
}
