// charge-balance-payment
// Charges the buyer's saved card (from the deposit_and_save deposit) for the
// remaining balance on a custom order, once the baker requests it. Fixes
// requestBalanceHold() in MarketplaceOrderSheet.swift, which was calling
// capture-payment — that only re-captures the already-captured deposit
// PaymentIntent and never actually charged the balance.
//
// Deposit-and-save orders are always single-baker, so the balance leg is a
// Stripe Connect direct charge on the same connected account as the deposit
// (payment_model = 'direct') — funds settle instantly, Stripe's fee comes
// out of the baker's balance automatically, and this function records the
// settlement (baker_transfer_id/stripe_fee_cents/baker_payout_cents) right
// away instead of waiting on release-baker-payouts. Legacy orders whose
// deposit predates this (payment_model = 'platform_custody') keep charging
// into Bakeri's own balance, swept out later exactly as before.
//
// The saved payment method lives on whichever account the deposit intent was
// created on, so the balance charge must be retrieved/created against that
// same account (or the platform, for a legacy order) — never mixed.
//
// POST body: { "order_id": "UUID" }
// Auth: Bearer {baker's Supabase JWT} — baker-initiated, must own the order

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement } from "../_shared/settlement.ts";
import { currencyForCountry } from "../_shared/currency.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const stripe = getStripeClient();

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
      .select("id, user_id, payment_intent_id, payment_flow, payment_model, quoted_price, deposit_amount_cents, buyer_profile_id, lead_channel")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== user.id) throw new Error("Forbidden — not your order");
    if (order.payment_flow !== "deposit_and_save") throw new Error("Order is not on the deposit_and_save flow");
    if (!order.payment_intent_id) throw new Error("No deposit payment intent on this order");

    const isDirect = order.payment_model === "direct";
    let connectedAccountId: string | null = null;
    let currency = "cad";
    if (isDirect) {
      const { data: baker } = await admin
        .from("profiles")
        .select("stripe_connect_account_id, stripe_connect_onboarding_complete, country")
        .eq("id", order.user_id)
        .single();
      if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
        throw new Error("This baker's Stripe account is no longer connected — cannot charge the balance.");
      }
      connectedAccountId = baker.stripe_connect_account_id;
      currency = currencyForCountry(baker.country);
    }
    const stripeOpts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

    const depositCents = order.deposit_amount_cents ?? 0;
    const totalCents = Math.round((order.quoted_price ?? 0) * 100);
    const baseBalanceCents = totalCents - depositCents;
    if (baseBalanceCents <= 0) throw new Error("No balance remaining to charge");

    // Must match whichever channel the deposit leg was charged under
    // (create-guest-quote-payment-intent vs pay-quote-order): a guest buyer
    // never gets Bakeri's fee added to their charge (it comes out of the
    // baker's side only); an app buyer pays it on top AND the baker also
    // loses a matching cut (2026-08-02 — see pay-quote-order's comment on
    // why that means application_fee_amount must be doubled, not just
    // "not shrunk").
    const isGuest = order.buyer_profile_id === null && order.lead_channel === "website";
    const platformFeeCents = Math.round(baseBalanceCents * PLATFORM_FEE_RATE);
    const balanceCents = baseBalanceCents + (isGuest ? 0 : platformFeeCents);
    // The actual total taken from the baker's side via application_fee_amount
    // — one fee-worth for a guest order, two for an app order — also what
    // gets stored/read back for payout settlement below.
    const takenFeeCents = isGuest ? platformFeeCents : platformFeeCents * 2;

    // Pull the payment method off the original deposit intent — it was saved
    // via setup_future_usage: "off_session" at deposit time, on whichever
    // account the deposit itself was charged to.
    let depositIntent;
    try {
      depositIntent = await stripe.paymentIntents.retrieve(order.payment_intent_id, stripeOpts);
    } catch {
      throw new Error("Could not retrieve deposit payment intent");
    }
    const paymentMethodId = depositIntent.payment_method as string | null;
    if (!paymentMethodId) throw new Error("No saved payment method on the deposit — buyer will need to pay manually");

    // Off-session charge for the balance, confirmed immediately.
    const createParams: Record<string, unknown> = {
      amount: balanceCents,
      currency,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      capture_method: "automatic",
      metadata: { order_id, charge_type: "balance" },
    };
    if (isDirect) {
      createParams.application_fee_amount = takenFeeCents;
    }

    let balanceIntent;
    try {
      // deno-lint-ignore no-explicit-any
      balanceIntent = await stripe.paymentIntents.create(createParams as any, stripeOpts);
    } catch (err: unknown) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.code ?? (err as any)?.raw?.code;
      if (code === "authentication_required") {
        throw new Error("Buyer's card requires additional verification — ask them to complete payment in the app instead");
      }
      throw new Error(err instanceof Error ? err.message : "Stripe balance charge failed");
    }

    const updateFields: Record<string, unknown> = {
      payment_intent_id: balanceIntent.id,
      payment_status: "captured",
      is_paid: true,
      paid_at: new Date().toISOString(),
      platform_fee_cents: takenFeeCents,
      updated_at: new Date().toISOString(),
    };

    if (isDirect && connectedAccountId) {
      // Direct charge already settled instantly — record the real Stripe fee
      // and mark the payout leg closed so release-baker-payouts's sweep
      // (gated on payment_model = 'platform_custody') never touches it.
      const settlement = await readDirectChargeSettlement(stripe, balanceIntent.id, connectedAccountId, takenFeeCents);
      if (settlement) Object.assign(updateFields, settlement);
    }

    const { error: updateErr } = await admin
      .from("orders")
      .update(updateFields)
      .eq("id", order_id);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    return new Response(
      JSON.stringify({ success: true, balance_payment_intent_id: balanceIntent.id, amount_charged_cents: balanceCents, platform_fee_cents: takenFeeCents }),
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
