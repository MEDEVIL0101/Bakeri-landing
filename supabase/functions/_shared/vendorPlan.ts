// A vendor's Bakeri plan as the payment functions need it: whether their
// shop can take new orders, and the platform fee rate on their sales.
// Reads effective_plan_tier() (migration 20261023000001_vendor_plans).
//
// Fails safe in both directions: if the plan can't be read (function
// missing, network), the shop stays open and the fee is today's 5% —
// never an accidental fee-free sale, never a shop wrongly closed.

import { PLATFORM_FEE_RATE } from "./fees.ts";
import { PLAN_FEE_RATE, type PlanTier } from "./plans.ts";

// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/** 'starter' | 'pro' | 'none', or null when it couldn't be read. */
export async function vendorTier(db: Db, bakerId: string): Promise<PlanTier | "none" | null> {
  try {
    const { data, error } = await db.rpc("effective_plan_tier", { p_user_id: bakerId });
    if (error || typeof data !== "string") return null;
    return data === "starter" || data === "pro" || data === "none" ? data : null;
  } catch {
    return null;
  }
}

/** True only when the vendor definitely has no live plan (trial/subscription ended). */
export async function vendorPlanPaused(db: Db, bakerId: string): Promise<boolean> {
  return (await vendorTier(db, bakerId)) === "none";
}

/** Bakeri's fee rate on this vendor's sales: their plan's rate, else 5%. */
export async function vendorFeeRate(db: Db, bakerId: string): Promise<number> {
  const tier = await vendorTier(db, bakerId);
  return tier === "starter" || tier === "pro" ? PLAN_FEE_RATE[tier] : PLATFORM_FEE_RATE;
}
