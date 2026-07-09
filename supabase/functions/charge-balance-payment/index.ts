// charge-balance-payment
// Charges the buyer's saved card (from the deposit_and_save deposit) for the
// remaining balance on a custom order, once the baker requests it. Fixes
// requestBalanceHold() in MarketplaceOrderSheet.swift, which was calling
// capture-payment — that only re-captures the already-captured deposit
// PaymentIntent and never actually charged the balance.
//
// The deposit itself already transferred to the baker's Connect account
// instantly (non-refundable, no dispute-window risk). The balance is a real
// payment like any other order, so it captures into Bakeri's own balance —
// orders.payment_intent_id is overwritten to point at this new PaymentIntent
// so release-baker-payouts picks it up and transfers the balance's 95% once
// the 24h dispute window (from completed_at) passes, exactly like any other
// order — no changes needed to the sweep itself.
//
// POST body: { "order_id": "UUID" }
// Auth: Bearer {baker's Supabase JWT} — baker-initiated, must own the order

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { order_id }: { order_id: string } = await req.json();
    if (!order_id) throw new Error("order_id is required");

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, user_id, payment_intent_id, payment_flow, quoted_price, deposit_amount_cents")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) throw new Error("Forbidden — not your order");
    if (order.payment_flow !== "deposit_and_save") throw new Error("Order is not on the deposit_and_save flow");
    if (!order.payment_intent_id) throw new Error("No deposit payment intent on this order");

    const depositCents = order.deposit_amount_cents ?? 0;
    const totalCents = Math.round((order.quoted_price ?? 0) * 100);
    const balanceCents = totalCents - depositCents;
    if (balanceCents <= 0) throw new Error("No balance remaining to charge");

    // Pull the payment method off the original deposit intent — it was saved
    // via setup_future_usage: "off_session" at deposit time.
    const depositIntentRes = await fetch(`https://api.stripe.com/v1/payment_intents/${order.payment_intent_id}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!depositIntentRes.ok) throw new Error("Could not retrieve deposit payment intent");
    const depositIntent = await depositIntentRes.json();
    const paymentMethodId = depositIntent.payment_method;
    if (!paymentMethodId) throw new Error("No saved payment method on the deposit — buyer will need to pay manually");

    // Off-session charge for the balance, confirmed immediately.
    const chargeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(balanceCents),
        currency: "cad",
        payment_method: paymentMethodId,
        confirm: "true",
        off_session: "true",
        capture_method: "automatic",
        "metadata[order_id]": order_id,
        "metadata[charge_type]": "balance",
      }),
    });

    if (!chargeRes.ok) {
      const err = await chargeRes.json();
      // authentication_required = card needs the buyer present (3DS etc.) — surface clearly
      const code = err.error?.code;
      if (code === "authentication_required") {
        throw new Error("Buyer's card requires additional verification — ask them to complete payment in the app instead");
      }
      throw new Error(err.error?.message ?? "Stripe balance charge failed");
    }

    const balanceIntent = await chargeRes.json();

    const { error: updateErr } = await admin
      .from("orders")
      .update({
        payment_intent_id: balanceIntent.id,
        payment_status: "captured",
        is_paid: true,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order_id);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    return new Response(
      JSON.stringify({ success: true, balance_payment_intent_id: balanceIntent.id, amount_charged_cents: balanceCents }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
