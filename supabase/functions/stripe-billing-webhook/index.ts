// stripe-billing-webhook
// Keeps vendor_plans in step with Stripe Billing (Bakeri's own platform
// account — vendor plans, not vendor sales; those go to
// stripe-connect-webhook). The only writer of paid tiers.
//
// Endpoint: Stripe Dashboard → Developers → Webhooks, on the account whose
// key is STRIPE_BILLING_SECRET_KEY, pointing at
//   https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/stripe-billing-webhook
// with its signing secret in STRIPE_BILLING_WEBHOOK_SECRET. Deploy with
// --no-verify-jwt (Stripe sends no Supabase JWT). Events:
//   checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted
//
// Every event is handled the same way: re-fetch the subscription from
// Stripe and write its current state. That makes delivery order and
// retries harmless, and the stored shape follows this client's pinned API
// version rather than the endpoint's.
//
// Signature check must be constructEventAsync + the SubtleCrypto provider —
// the sync constructEvent throws in Deno and every event silently 400s
// (that took down stripe-connect-webhook once).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { adminClient } from "../_shared/billingAuth.ts";
import { billingSecretKey, tierForPriceId } from "../_shared/plans.ts";

const stripe = new Stripe(billingSecretKey(), { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = Deno.env.get("STRIPE_BILLING_WEBHOOK_SECRET") ?? "";
const LIVE_STATUSES = ["trialing", "active", "past_due"];

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature || !WEBHOOK_SECRET) return new Response("Missing signature", { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error("Signature check failed:", e instanceof Error ? e.message : e);
    return new Response("Bad signature", { status: 400 });
  }

  let subscriptionId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.mode === "subscription" && s.subscription) subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  }
  if (!subscriptionId) return new Response("ignored", { status: 200 });

  try {
    await syncSubscription(subscriptionId);
    return new Response("ok", { status: 200 });
  } catch (e) {
    // 500 so Stripe retries.
    console.error(`Syncing ${subscriptionId} (${event.type}) failed:`, e instanceof Error ? e.message : e);
    return new Response("sync failed", { status: 500 });
  }
});

async function syncSubscription(id: string) {
  const sub = await stripe.subscriptions.retrieve(id);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const db = adminClient();

  let userId = sub.metadata?.user_id || null;
  if (!userId) {
    const { data } = await db.from("vendor_plans").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) throw new Error(`No vendor for customer ${customerId}`);

  const { data: current, error: readErr } = await db.from("vendor_plans")
    .select("stripe_subscription_id, status, trial_used_at").eq("user_id", userId).maybeSingle();
  if (readErr) throw readErr;

  const live = LIVE_STATUSES.includes(sub.status);
  // An old subscription ending must not overwrite a newer live one.
  if (!live && current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id && LIVE_STATUSES.includes(current.status)) return;

  const item = sub.items.data[0];
  const match = tierForPriceId(item?.price?.id);
  if (live && !match) throw new Error(`Unknown price ${item?.price?.id} on ${sub.id}`);

  const row = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: item?.price?.id ?? null,
    tier: live && match ? match.tier : "none",
    billing_interval: match?.interval ?? null,
    status: sub.status,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    trial_used_at: current?.trial_used_at ?? (sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("vendor_plans").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}
