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
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid, charge.refunded, customer.subscription.trial_will_end
//
// invoice.paid / charge.refunded drive Refer a Vendor: 20% of each paid
// plan invoice (before tax) accrues to the vendor's referrer for as long as
// the vendor stays subscribed — provided the referrer has an active plan
// themselves — and a fully refunded invoice reverses it
// (20261023000002_referrals_from_plans.sql, 20261029000001_bakeri_referral_program.sql).
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
import { appURL, billingSecretKey, tierForPriceId } from "../_shared/plans.ts";
import { sendEmail } from "../_shared/resend.ts";
import { sendTeamAlert } from "../_shared/teamAlert.ts";

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

  try {
    if (event.type === "invoice.paid") {
      await accrueReferral((event.data.object as Stripe.Invoice).id);
      await markFirstPaid(event.data.object as Stripe.Invoice);
      return new Response("ok", { status: 200 });
    }
    if (event.type === "customer.subscription.trial_will_end") {
      await sendTrialEndingEmail(event.data.object as Stripe.Subscription);
      return new Response("ok", { status: 200 });
    }
    if (event.type === "charge.refunded") {
      await reverseReferral((event.data.object as Stripe.Charge).id);
      return new Response("ok", { status: 200 });
    }
  } catch (e) {
    console.error(`${event.type} ${event.id} failed:`, e instanceof Error ? e.message : e);
    return new Response("failed", { status: 500 });
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
    .select("stripe_subscription_id, status, trial_used_at, past_due_since").eq("user_id", userId).maybeSingle();
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
    // When the current failed-payment spell began — effective_plan_tier()
    // gives a past_due plan 3 days (never paid) or 7 days (renewal).
    past_due_since: sub.status === "past_due" ? (current?.past_due_since ?? new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("vendor_plans").upsert(row, { onConflict: "user_id" });
  if (error) throw error;

  if (sub.status === "trialing") await enforceOneTrialPerCard(sub, userId);

  // A plan just started (new trial or straight to paid) — not a renewal or a
  // trial converting, which keep the same live subscription.
  const alreadyLive = current?.stripe_subscription_id === sub.id && LIVE_STATUSES.includes(current.status);
  if (live && match && !alreadyLive) await announcePlanStart(sub, userId, match);
}

/** Tells the team inbox about a new trial or paid plan (Harvey 2026-11-13). Never throws. */
async function announcePlanStart(sub: Stripe.Subscription, userId: string, match: { tier: string; interval: string }) {
  try {
    const db = adminClient();
    const [{ data: u }, { data: p }] = await Promise.all([
      db.auth.admin.getUserById(userId),
      db.from("profiles").select("business_name, profile_slug").eq("id", userId).maybeSingle(),
    ]);
    const email = u?.user?.email ?? null;
    const plan = `${match.tier === "pro" ? "Pro" : "Starter"} (${match.interval === "year" ? "yearly" : "monthly"})`;
    const trial = sub.status === "trialing";
    const fmt = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium" });
    await sendTeamAlert({
      eyebrow: trial ? "New trial" : "New subscription",
      subject: `${trial ? "New trial" : "New paid plan"}: ${plan}, ${p?.business_name || email || userId}`,
      heading: trial ? `A ${plan} trial just started` : `A ${plan} plan just started`,
      rows: [
        ["Email", email],
        ["Business", p?.business_name],
        ["Storefront", p?.profile_slug ? `bakeriapp.com/${p.profile_slug}` : null],
        ["Plan", plan],
        ["Status", trial ? "Free trial" : sub.status === "active" ? "Paid" : sub.status],
        ["Trial ends", trial && sub.trial_end ? fmt(sub.trial_end) : null],
        ["Discount", sub.discount?.coupon?.name ?? sub.discount?.coupon?.id ?? null],
      ],
      replyTo: email,
    });
  } catch (e) {
    console.error(`Plan-start alert for ${sub.id} failed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * One free trial per card: records the trial card's fingerprint, and if a
 * different account already had a trial on the same card, ends this trial
 * now — Stripe then charges the card immediately.
 */
async function enforceOneTrialPerCard(sub: Stripe.Subscription, userId: string) {
  const pmId = typeof sub.default_payment_method === "string" ? sub.default_payment_method : sub.default_payment_method?.id;
  if (!pmId) return;
  const pm = await stripe.paymentMethods.retrieve(pmId);
  const fingerprint = pm.card?.fingerprint;
  if (!fingerprint) return;
  const db = adminClient();
  const { error } = await db.from("vendor_plans").update({ trial_card_fingerprint: fingerprint }).eq("user_id", userId);
  if (error) throw error;
  const { data: others, error: e2 } = await db.from("vendor_plans")
    .select("user_id").eq("trial_card_fingerprint", fingerprint).neq("user_id", userId).not("trial_used_at", "is", null).limit(1);
  if (e2) throw e2;
  if (others && others.length > 0) {
    console.log(`Trial on ${sub.id} ended early: card already used for a trial by another account`);
    await stripe.subscriptions.update(sub.id, { trial_end: "now", proration_behavior: "none" });
  }
}

async function markFirstPaid(invoice: Stripe.Invoice) {
  if (!invoice.subscription || (invoice.amount_paid ?? 0) <= 0) return;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const { error } = await adminClient().from("vendor_plans")
    .update({ first_paid_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId).is("first_paid_at", null);
  if (error) throw error;
}

/** Stripe sends trial_will_end 3 days before a trial ends; the welcome page promises this email. */
async function sendTrialEndingEmail(sub: Stripe.Subscription) {
  if (sub.status !== "trialing" || !sub.trial_end || sub.cancel_at_period_end) return;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const customer = await stripe.customers.retrieve(customerId);
  const to = "deleted" in customer && customer.deleted ? null : (customer as Stripe.Customer).email;
  if (!to) return;
  const price = sub.items.data[0]?.price;
  const match = tierForPriceId(price?.id);
  const plan = match?.tier === "pro" ? "Pro" : "Starter";
  const amount = price?.unit_amount != null
    ? `$${(price.unit_amount / 100).toFixed(2)} ${(price.currency ?? "usd").toUpperCase()} per ${match?.interval ?? price.recurring?.interval ?? "month"}`
    : "your plan price";
  const ends = new Date(sub.trial_end * 1000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const manage = appURL("plan");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A130F;line-height:1.55">
  <h2 style="margin:0 0 12px">Your free trial ends ${ends}</h2>
  <p>Your Bakerï ${plan} trial ends on <strong>${ends}</strong>. After that, the card on file will be charged <strong>${amount}</strong>, and your plan will renew automatically until you cancel.</p>
  <p>Nothing to do if you'd like to keep going. To change plans or cancel before you're charged, open Plan &amp; billing:</p>
  <p><a href="${manage}" style="display:inline-block;background:#1A130F;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Manage my plan</a></p>
  <p style="color:#6b6157;font-size:13px">Questions? Just reply to this email.</p>
</div>`;
  const r = await sendEmail({
    from: "Bakerï <hello@bakeriapp.com>",
    to,
    reply_to: "hello@bakeriapp.com",
    subject: `Your Bakerï trial ends ${ends}`,
    html,
  });
  if (!r.ok) throw new Error(`Trial reminder email failed: ${r.error}`);
}

/** The vendor a Stripe customer belongs to (metadata first, then vendor_plans). */
async function vendorForCustomer(customerId: string, metadataUserId?: string | null): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const { data } = await adminClient().from("vendor_plans").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}

async function accrueReferral(invoiceId: string) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (!invoice.subscription) return; // only plan invoices
  const amount = (invoice.amount_paid ?? 0) - (invoice.tax ?? 0);
  if (amount <= 0) return; // trials and $0 invoices earn nothing
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const userId = await vendorForCustomer(customerId, invoice.subscription_details?.metadata?.user_id);
  if (!userId) throw new Error(`No vendor for customer ${customerId}`);
  const { error } = await adminClient().rpc("accrue_referral_plan_earning", {
    p_referred_baker_id: userId, p_invoice_id: invoice.id, p_amount_cents: amount, p_currency: invoice.currency,
  });
  if (error) throw error;
}

async function reverseReferral(chargeId: string) {
  const charge = await stripe.charges.retrieve(chargeId);
  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id;
  // Only a full refund undoes the plan payment the commission came from.
  if (!invoiceId || !charge.refunded) return;
  const { error } = await adminClient().rpc("reverse_referral_plan_earning", { p_invoice_id: invoiceId, p_reason: "refunded" });
  if (error) throw error;
}
