// Bakeri's vendor plans — the server-side source of truth for which tiers
// exist, what each costs in Stripe, and the platform fee each pays on sales.
// Mirrored for display by webapp/src/lib/plans.ts (names, prices, perks).
//
// Tiers (Harvey 2026-10-30): a free trial (PLAN_TRIAL_DAYS, once per
// vendor) on the plan they pick, then Starter $10/mo + 5% Bakeri fee per
// sale, or Pro $30/mo with no Bakeri fee; yearly = 2 months free ($100 / $300); Stripe card fees are the
// vendor's on both. Trial: 14 days (Harvey 2026-11-13; 7 from 2026-10-30). Billing is web-only
// through Stripe Billing on Bakeri's platform account — never Apple IAP.
//
// Stripe Price ids come from secrets so test mode and live mode can differ:
//   STRIPE_PRICE_STARTER_MONTH, STRIPE_PRICE_PRO_MONTH,
//   STRIPE_PRICE_STARTER_YEAR, STRIPE_PRICE_PRO_YEAR
// and an optional automatic Starter coupon from STRIPE_STARTER_LAUNCH_COUPON
// (unset since the $10 pricing, 2026-10-30 — set it to run a launch sale);
// (…_YEAR variants are supported if yearly billing is ever offered)
// and the Billing calls use STRIPE_BILLING_SECRET_KEY when it's set (e.g. a
// test key while building), otherwise the live STRIPE_SECRET_KEY that vendor
// payments already use — plans went live on it 2026-10-30. The price ids and
// coupon above must belong to the same mode as the key in use.

export type PlanTier = "starter" | "pro";
export type BillingInterval = "month" | "year";

export const PAID_TIERS: PlanTier[] = ["starter", "pro"];

/** Platform fee on storefront sales, by tier. Not wired into charges yet. */
export const PLAN_FEE_RATE: Record<PlanTier, number> = {
  starter: 0.05,
  pro: 0,
};

/** Free trial on a vendor’s first subscription (14 days). */
export function trialDays(): number {
  const n = Number(Deno.env.get("PLAN_TRIAL_DAYS") ?? 14);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function priceIdFor(tier: PlanTier, interval: BillingInterval): string | null {
  return Deno.env.get(`STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`) || null;
}

/** The tier + interval a Stripe Price id belongs to (for the webhook). */
export function tierForPriceId(priceId: string | null | undefined): { tier: PlanTier; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const tier of PAID_TIERS) {
    for (const interval of ["month", "year"] as BillingInterval[]) {
      if (priceIdFor(tier, interval) === priceId) return { tier, interval };
    }
  }
  return null;
}

/** Referral Program: 10% off the first 3 months (Stripe coupon, repeating 3
 * months — on yearly billing that's 10% off the first year's payment). */
export function referralCoupon(): string {
  return Deno.env.get("STRIPE_REFERRAL_COUPON") || "BAKERI_REFERRAL_10";
}

/** Coupon applied automatically at checkout, if any — the Starter launch sale is monthly billing only. */
export function launchCouponFor(tier: PlanTier, interval: BillingInterval): string | null {
  return tier === "starter" && interval === "month" ? Deno.env.get("STRIPE_STARTER_LAUNCH_COUPON") || null : null;
}

export function billingSecretKey(): string {
  return Deno.env.get("STRIPE_BILLING_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || "";
}

/** Where Stripe sends the vendor back to (the web app's plan pages). */
export function appURL(path: string): string {
  const base = (Deno.env.get("BAKERI_APP_URL") || "https://bakeriapp.com/app").replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}
