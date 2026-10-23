// create-plan-checkout
// Starts a Stripe Checkout (mode=subscription) for a paid vendor plan and
// returns its hosted URL. Web-only: called from the web app's plan picker,
// never from the iOS app (no prices or buy links in the app — App Store
// anti-steering rules).
//
// Body: { tier: "pro" | "business", interval?: "month" | "year" }
//
// A vendor who already has a live paid subscription gets a billing-portal
// URL instead ({ url, portal: true }) — switching between paid plans,
// card changes and cancelling all happen there, so there's only ever one
// subscription per vendor. The plan itself is recorded by
// stripe-billing-webhook once Stripe confirms payment, not here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { adminClient, corsHeaders, json, requireUser } from "../_shared/billingAuth.ts";
import { PAID_TIERS, appURL, billingSecretKey, priceIdFor, type BillingInterval, type PlanTier } from "../_shared/plans.ts";

const LIVE_STATUSES = ["active", "trialing", "past_due"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Please sign in to continue." }, 401);

    const body = await req.json().catch(() => ({}));
    const tier = body.tier as PlanTier;
    const interval: BillingInterval = body.interval === "year" ? "year" : "month";
    if (!PAID_TIERS.includes(tier)) return json({ error: "Unknown plan." }, 400);

    const key = billingSecretKey();
    const price = priceIdFor(tier, interval);
    if (!key || !price) return json({ error: "Paid plans aren't available yet.", code: "plans_not_configured" }, 503);
    const stripe = new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

    const db = adminClient();
    const { data: plan, error: planErr } = await db
      .from("vendor_plans")
      .select("tier, status, stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (planErr) throw planErr;

    if (plan?.stripe_customer_id && plan.stripe_subscription_id && plan.tier !== "free" && LIVE_STATUSES.includes(plan.status)) {
      const portal = await stripe.billingPortal.sessions.create({ customer: plan.stripe_customer_id, return_url: appURL("plan") });
      return json({ url: portal.url, portal: true });
    }

    let customerId = plan?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } });
      customerId = customer.id;
      const { error } = await db.from("vendor_plans")
        .upsert({ user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { user_id: user.id, tier, interval },
      subscription_data: { metadata: { user_id: user.id } },
      // Sales tax on plans waits for Stripe Tax (paused, see
      // project notes) — add automatic_tax here when it's finished.
      success_url: appURL("welcome?checkout={CHECKOUT_SESSION_ID}"),
      cancel_url: appURL("plan"),
    });
    return json({ url: session.url });
  } catch (e) {
    console.error("create-plan-checkout failed:", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't start checkout. Please try again." }, 500);
  }
});
