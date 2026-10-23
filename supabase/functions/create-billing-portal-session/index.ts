// create-billing-portal-session
// Returns a Stripe Billing customer-portal URL where the vendor changes
// plan, updates their card, sees invoices or cancels. Web-only, like
// create-plan-checkout. Changes made there reach vendor_plans through
// stripe-billing-webhook.
//
// The portal's options (which plans can be switched to, cancellation
// behaviour) are set in the Stripe Dashboard → Settings → Billing →
// Customer portal, separately for test and live mode.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { adminClient, corsHeaders, json, requireUser } from "../_shared/billingAuth.ts";
import { appURL, billingSecretKey } from "../_shared/plans.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Please sign in to continue." }, 401);
    const key = billingSecretKey();
    if (!key) return json({ error: "Billing isn't available yet.", code: "plans_not_configured" }, 503);

    const { data: plan, error } = await adminClient()
      .from("vendor_plans").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!plan?.stripe_customer_id) return json({ error: "You don't have a paid plan yet.", code: "no_customer" }, 404);

    const stripe = new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
    const portal = await stripe.billingPortal.sessions.create({ customer: plan.stripe_customer_id, return_url: appURL("plan") });
    return json({ url: portal.url });
  } catch (e) {
    console.error("create-billing-portal-session failed:", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't open billing. Please try again." }, 500);
  }
});
