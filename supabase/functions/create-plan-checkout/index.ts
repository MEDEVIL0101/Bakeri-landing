// create-plan-checkout
// Starts a Stripe Checkout (mode=subscription) for a paid vendor plan and
// returns its hosted URL. Web-only: called from the web app's plan picker,
// never from the iOS app (no prices or buy links in the app — App Store
// anti-steering rules).
//
// Body: { tier: "starter" | "pro", interval?: "month" | "year" }
//
// A vendor's first subscription starts with the free trial (card taken up
// front, first charge when the trial ends); vendor_plans.trial_used_at
// stops a second one.
//
// A vendor who already has a live paid subscription gets a billing-portal
// URL instead ({ url, portal: true }) — switching between paid plans,
// card changes and cancelling all happen there, so there's only ever one
// subscription per vendor. The plan itself is recorded by
// stripe-billing-webhook once Stripe confirms payment, not here.
//
// Referral Program: a vendor who signed up with a referral code (web sign-up
// keeps it in user_metadata.referral_code) is attributed to the referrer
// when their profile is created (profiles_attribute_signup_referral) and,
// until they've paid for a plan once, gets 10% off their first 3 months
// (referralCoupon()).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { adminClient, corsHeaders, json, requireUser } from "../_shared/billingAuth.ts";
import { PAID_TIERS, appURL, billingSecretKey, launchCouponFor, priceIdFor, referralCoupon, trialDays, type BillingInterval, type PlanTier } from "../_shared/plans.ts";

const LIVE_STATUSES = ["trialing", "active", "past_due"];

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
      .select("tier, status, stripe_customer_id, stripe_subscription_id, trial_used_at, grandfathered_starter, first_paid_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (planErr) throw planErr;

    // Grandfathered vendors already have Starter free, forever.
    if (tier === "starter" && plan?.grandfathered_starter) return json({ error: "Starter is already free for you." }, 400);

    if (plan?.stripe_customer_id && plan.stripe_subscription_id && plan.tier !== "none" && LIVE_STATUSES.includes(plan.status)) {
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

    // Referred? Either already recorded (referrals), or — the usual case at
    // first checkout, before the vendor has a profile to attribute to — the
    // code from their sign-up is a live code belonging to someone else with
    // an active plan. (The referral itself is recorded when the profile is
    // created: profiles_attribute_signup_referral.)
    const { data: referral } = await db.from("referrals")
      .select("id").eq("referred_baker_id", user.id).eq("status", "active").maybeSingle();
    let referred = !!referral;
    const signupCode = String(user.user_metadata?.referral_code ?? "").trim();
    if (!referred && signupCode) {
      const { data: r } = await db.rpc("resolve_referral_code", { p_code: signupCode });
      const referrer = r?.status === "valid" ? String(r.referrer_user_id ?? "") : "";
      if (referrer && referrer !== user.id) {
        const { data: active } = await db.rpc("referrer_has_active_plan", { p_user_id: referrer });
        referred = active === true;
      }
    }
    // A live plan sale (plan_sales, e.g. Black Friday) beats the referral 10% on
    // a first monthly plan — Stripe Checkout takes one discount.
    let saleCoupon: string | null = null;
    if (interval === "month" && !plan?.first_paid_at) {
      const { data: sale } = await db.rpc("active_plan_sale");
      if (sale?.id) {
        const { data: row } = await db.from("plan_sales").select("stripe_coupon_id").eq("id", sale.id).maybeSingle();
        saleCoupon = row?.stripe_coupon_id ?? null;
      }
    }
    const coupon = saleCoupon ?? (referred && !plan?.first_paid_at ? referralCoupon() : launchCouponFor(tier, interval));

    // Promo code (plan_promo_codes) from sign-up: a longer first trial on its plan.
    let trial = !plan?.trial_used_at ? trialDays() : 0;
    let promo: string | null = null;
    if (trial && signupCode && !referred) {
      const { data: p } = await db.rpc("resolve_plan_promo", { p_code: signupCode });
      if (p?.tier === tier && Number(p.trial_days) > 0) { trial = Number(p.trial_days); promo = String(p.code); }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      // Stripe allows either an automatic coupon or a promo-code box, not both.
      ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
      metadata: { user_id: user.id, tier, interval, ...(coupon === referralCoupon() ? { referral: "1" } : {}), ...(saleCoupon ? { sale: saleCoupon } : {}), ...(promo ? { promo } : {}) },
      subscription_data: {
        metadata: { user_id: user.id, ...(promo ? { promo } : {}) },
        ...(trial ? { trial_period_days: trial } : {}),
      },
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
