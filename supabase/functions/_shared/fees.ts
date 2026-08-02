// Single source of truth for Bakeri's service charge math — was previously
// copy-pasted independently across ~11 files (each with a comment warning it
// must be kept in sync manually).

// As of 2026-08-02: for in-app marketplace orders, added on top of the
// customer's charge (see 20260728000001_customer_paid_platform_fee.sql for
// the original 2026-07-27 decision) AND taken in full from the baker's cut
// via application_fee_amount — both sides pay. For guest/website-storefront
// orders, NOT added to the customer's charge at all — taken only from the
// baker's cut, same as the app's baker-side share. Each call site computes
// and applies this rate according to which of those two it is; this
// constant is just the shared 5% number.
export const PLATFORM_FEE_RATE = 0.05;

// Stripe's published CAD domestic-card rate. Used only to estimate, at
// charge-creation time, how much of a direct charge's Stripe processing fee
// is attributable to Bakeri's own platform-fee slice (see
// calcDirectChargeApplicationFee below) — the real fee isn't known until
// Stripe reports it after the charge settles. Confirm this matches Bakeri's
// actual negotiated Stripe rate; international/Amex cards run higher, so
// this slightly under-estimates the fee share on those, and Bakeri absorbs
// that drift (never the baker).
export const STRIPE_FEE_ESTIMATE = {
  pct: 0.029,
  fixedCents: 30,
};

export function calcPlatformFeeCents(baseCents: number): number {
  return Math.round(baseCents * PLATFORM_FEE_RATE);
}

// For a Stripe Connect *direct* charge (created on the baker's own connected
// account), Stripe deducts its processing fee from the whole charge amount —
// base price + Bakeri's platform fee — against the baker's balance, since the
// baker is the charge's merchant of record. Left alone, that means the baker
// ends up bearing Stripe's fee on Bakeri's cut too, not just their own price.
//
// To keep the baker's net take equal to exactly "their price minus Stripe's
// fee on their price" (and have Bakeri absorb only the percentage-based fee
// on its own slice — never any share of Stripe's flat per-charge fee, which
// lands entirely on the baker), the application_fee_amount Bakeri actually
// collects is shrunk by only the *percentage* portion of the estimated fee
// attributable to platformFeeCents:
//
//   application_fee_amount = platformFeeCents - round(platformFeeCents * STRIPE_PCT)
//
// Deliberately NOT proportionally allocating the flat fee here (an earlier
// version of this function did — `feeShareOnPlatformCut = round(estimatedStripeFee
// * platformFeeCents / totalChargeCents)` — which let Bakeri absorb a slice of
// the flat 30c fee too, shrinking its take on small orders far more than
// intended: on a $10 order, Bakeri's $0.50 cut dropped to ~$0.47 instead of
// ~$0.49). This is exact algebra (baker net = price - price*pct - flatFee,
// up to rounding) as long as the flat fee is charged exactly once per Stripe
// charge, which callers must ensure by passing the one real total the charge
// amount actually represents.
export function calcDirectChargeApplicationFee(
  totalChargeCents: number,
  platformFeeCents: number
): number {
  if (totalChargeCents <= 0 || platformFeeCents <= 0) return 0;

  const bakeriShareOfStripeFee = Math.round(platformFeeCents * STRIPE_FEE_ESTIMATE.pct);
  return Math.max(0, platformFeeCents - bakeriShareOfStripeFee);
}
