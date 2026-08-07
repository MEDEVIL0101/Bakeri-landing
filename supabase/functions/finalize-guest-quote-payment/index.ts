import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement, toDepositSettlementFields } from "../_shared/settlement.ts";

// Public, unauthenticated endpoint for baker/pay-quote.html, called right
// after Stripe confirms payment client-side. Re-verifies the PaymentIntent's
// live status with Stripe before trusting it — never trusts the client — then
// moves the order straight to "confirmed" (the baker already committed to
// this price when they sent the quote, so no further baker review step is
// needed, unlike a fresh Buy Now order).
//
// 2026-08-07 fix: this used to unconditionally set is_paid=true and
// payment_status="authorized" regardless of whether the PaymentIntent
// actually charged the full quoted_price or just a deposit (see the matching
// fix in create-guest-quote-payment-intent) — which both overstated a
// deposit-only payment as "fully paid" AND, for a genuine full payment,
// left it tagged "authorized" (which the app's own badge UI reads as
// "Payment Held", i.e. not yet captured) instead of "captured", so the
// baker's order screen never showed a clear "paid" state even though Stripe
// had already captured the money. Now branches on which leg was actually
// charged (via the PaymentIntent's own `leg` metadata, authoritative since
// it's set server-side at charge-creation time) — same deposit/full split
// finalize-invoice-payment already uses for the analogous invoice flow.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const order_id = String(body.order_id ?? "").trim();
  const payment_intent_id = String(body.payment_intent_id ?? "").trim();
  if (!order_id || !payment_intent_id) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, user_id, buyer_profile_id, lead_channel, marketplace_status, is_paid, quoted_price, deposit_amount_cents, deposit_paid_at")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) return json({ error: "Quote not found." }, 404);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Quote not found." }, 404);
  }
  if (order.is_paid) {
    // Already finalized (e.g. a retried client call) — idempotent no-op success.
    return json({ ok: true });
  }
  // A deposit-only payment doesn't set is_paid — guard separately so a
  // retried client call can't double-charge or double-log the deposit.
  if (order.deposit_paid_at) {
    return json({ ok: true, already_paid: true });
  }
  if (order.marketplace_status !== "quote_provided") {
    return json({ error: "This quote is no longer awaiting payment." }, 400);
  }

  const { data: baker } = await db
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", order.user_id)
    .single();
  const connectedAccountId = baker?.stripe_connect_account_id ?? null;

  let intent;
  try {
    intent = connectedAccountId
      ? await stripe.paymentIntents.retrieve(payment_intent_id, { stripeAccount: connectedAccountId })
      : await stripe.paymentIntents.retrieve(payment_intent_id);
  } catch {
    return json({ error: "Could not verify payment." }, 400);
  }
  if (intent.status !== "succeeded") {
    return json({ error: "Payment has not completed yet." }, 400);
  }

  // Authoritative: set server-side by create-guest-quote-payment-intent at
  // charge-creation time, so it reflects what was actually charged rather
  // than the order's current (possibly since-changed) deposit configuration.
  const isDepositLeg = intent.metadata?.leg === "deposit";
  const depositCents = order.deposit_amount_cents ?? 0;
  const fullCents = Math.round(Number(order.quoted_price ?? 0) * 100);
  const baseCents = isDepositLeg ? depositCents : fullCents;
  const platformFeeCents = Math.round(baseCents * PLATFORM_FEE_RATE);

  // Direct charge already settled instantly — close the payout loop right
  // away instead of waiting on release-baker-payouts (whose sweep only runs
  // for platform_custody orders).
  const settlement = connectedAccountId
    ? await readDirectChargeSettlement(stripe, payment_intent_id, connectedAccountId, platformFeeCents)
    : null;

  const paidAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = isDepositLeg
    ? {
        marketplace_status: "confirmed",
        payment_intent_id,
        payment_status: "deposit_paid",
        payment_model: connectedAccountId ? "direct" : "platform_custody",
        deposit_amount: depositCents / 100,
        deposit_paid_at: paidAt,
        deposit_charged_at: paidAt,
        deposit_payment_intent_id: payment_intent_id,
        deposit_platform_fee_cents: platformFeeCents,
        updated_at: paidAt,
        ...(settlement ? toDepositSettlementFields(settlement) : {}),
      }
    : {
        is_paid: true,
        paid_at: paidAt,
        marketplace_status: "confirmed",
        payment_intent_id,
        payment_status: "captured",
        payment_model: connectedAccountId ? "direct" : "platform_custody",
        platform_fee_cents: platformFeeCents,
        updated_at: paidAt,
        ...(settlement ?? {}),
      };

  const { error: updateErr } = await db
    .from("orders")
    .update(updatePayload)
    .eq("id", order_id);

  if (updateErr) {
    console.error("order update failed:", updateErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  return json({ ok: true });
});
