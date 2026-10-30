// Bakeri's vendor plans — the server-side source of truth for which tiers
// exist, what each costs in Stripe, and the platform fee each pays on sales.
// Mirrored for display by webapp/src/lib/plans.ts (names, prices, perks).
//
// Tiers (Harvey 2026-10-30): a free trial (PLAN_TRIAL_DAYS, once per
// vendor) on the plan they pick, then Starter $14.99/mo + 5% Bakeri fee per
// sale ($5.99 launch sale for the first 2 months), or Pro $29.99/mo with no
// Bakeri fee; Stripe card fees are the
// vendor's on both. Trial: 14 days. Billing is web-only
// through Stripe Billing on Bakeri's platform account — never Apple IAP.
//
// Stripe Price ids come from secrets so test mode and live mode can differ:
//   STRIPE_PRICE_STARTER_MONTH, STRIPE_PRICE_PRO_MONTH
// and the Starter launch sale from STRIPE_STARTER_LAUNCH_COUPON (a $9-off,
// 2-month repeating coupon, id starter-launch-sale in live) — unset it to end
// the sale for new sign-ups;
// (…_YEAR variants are supported if yearly billing is ever offered)
// and the Billing calls use STRIPE_BILLING_SECRET_KEY only — deliberately no
// fallback to the live STRIPE_SECRET_KEY, so plans are built against a test
// key while vendor payments keep using the live one. Going live = set this
// secret (and the price ids) to live values.

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

/** Coupon applied automatically at checkout for this tier, if any. */
export function launchCouponFor(tier: PlanTier): string | null {
  return tier === "starter" ? Deno.env.get("STRIPE_STARTER_LAUNCH_COUPON") || null : null;
}

export function billingSecretKey(): string {
  return Deno.env.get("STRIPE_BILLING_SECRET_KEY") || "";
}

/** Where Stripe sends the vendor back to (the web app's plan pages). */
export function appURL(path: string): string {
  const base = (Deno.env.get("BAKERI_APP_URL") || "https://bakeriapp.com/app").replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}
