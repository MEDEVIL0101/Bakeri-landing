// Bakeri's vendor plans — the server-side source of truth for which tiers
// exist, what each costs in Stripe, and the platform fee each pays on sales.
// Mirrored for display by webapp/src/lib/plans.ts (names, prices, perks).
//
// PLACEHOLDER tiers/prices/fees (2026-10-23) until Harvey and Diana settle
// them. Billing is web-only through Stripe Billing on Bakeri's platform
// account — never Apple in-app purchase.
//
// Stripe Price ids come from secrets so test mode and live mode can differ:
//   STRIPE_PRICE_PRO_MONTH, STRIPE_PRICE_PRO_YEAR,
//   STRIPE_PRICE_BUSINESS_MONTH, STRIPE_PRICE_BUSINESS_YEAR
// and the Billing calls use STRIPE_BILLING_SECRET_KEY only — deliberately no
// fallback to the live STRIPE_SECRET_KEY, so plans are built against a test
// key while vendor payments keep using the live one. Going live = set this
// secret (and the price ids) to live values.

export type PlanTier = "free" | "pro" | "business";
export type BillingInterval = "month" | "year";

export const PAID_TIERS: PlanTier[] = ["pro", "business"];

/** Platform fee on storefront sales, by tier. Not wired into charges yet. */
export const PLAN_FEE_RATE: Record<PlanTier, number> = {
  free: 0.05,
  pro: 0.02,
  business: 0,
};

export function priceIdFor(tier: PlanTier, interval: BillingInterval): string | null {
  if (tier === "free") return null;
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

export function billingSecretKey(): string {
  return Deno.env.get("STRIPE_BILLING_SECRET_KEY") || "";
}

/** Where Stripe sends the vendor back to (the web app's plan pages). */
export function appURL(path: string): string {
  const base = (Deno.env.get("BAKERI_APP_URL") || "https://bakeriapp.com/app").replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}
