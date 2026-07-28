// release-baker-payouts
// Scheduled sweep (pg_cron, see 20260713000004_schedule_baker_payouts.sql):
// finds captured orders whose 24h dispute window has passed and transfers
// each baker's cut from Bakeri's own Stripe balance into their Connect
// account. This is the delayed half of the "separate charge, then transfer"
// model — no charge-creating function attaches transfer_data to any order
// any more (including deposits, as of 2026-07-28), so every charge sits in
// the platform balance until this sweep releases it.
//
// The baker's cut = amount_received, minus the platform fee, minus Stripe's
// *actual* processing fee on that charge (read from the charge's own
// balance_transaction rather than approximated, since real Stripe fees vary
// by card type/currency and this way never drifts from what Stripe really
// charged).
//
// As of 2026-07-28 the platform fee is no longer computed here as a
// percentage of amount_received — it's added to the customer's charge
// upfront (by create-payment-intent and friends) rather than carved out of
// the baker's cut, so amount_received already includes it and recomputing
// 5% of it here would double-dip. Instead we read the exact fee cents that
// were stored on the order at charge time (orders.platform_fee_cents) and
// simply subtract it back out. (Falls back to the old 5%-of-amount_received
// approximation only for pre-2026-07-28 orders that never got a stored
// platform_fee_cents.)
//
// Two independent legs are swept below:
//   1. The main/balance leg (every order type) — gated on
//      marketplace_status='completed' + completed_at past the dispute window,
//      same as always.
//   2. The deposit leg of deposit_and_save orders — previously transferred
//      instantly via a Stripe destination charge (application_fee_amount +
//      transfer_data), which deducts Stripe's fee from the *platform's* cut,
//      not the baker's. Unified into this same sweep (2026-07-28) so the
//      baker's deposit payout also reflects the real Stripe fee — gated on
//      its own dispute window (deposit_charged_at + 24h), independent of
//      whether the rest of the order has been completed yet, since a
//      deposit's own charge is what triggers its own dispute risk.
//
// Auth: internal only — x-webhook-secret header, matching capture-payment/
// cancel-order's convention. Never exposed to client JWTs.
//
// Required env vars:
//   STRIPE_SECRET_KEY, BAKERI_WEBHOOK_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET") ?? "";
const PLATFORM_FEE_RATE = 0.05; // fallback only, for orders predating stored platform_fee_cents
const DISPUTE_WINDOW_HOURS = 24;

interface MainLegOrder {
  id: string;
  user_id: string; // baker
  payment_intent_id: string;
  platform_fee_cents: number | null;
}

interface DepositLegOrder {
  id: string;
  user_id: string;
  deposit_payment_intent_id: string;
  deposit_platform_fee_cents: number | null;
}

type LegResult =
  | { outcome: "transferred"; transferAmount: number }
  | { outcome: "skipped_no_connect" }
  | { outcome: "skipped_mock" }
  | { outcome: "error"; message: string };

// Shared by both legs: retrieve the charge, read its real Stripe fee, transfer
// (amount_received - storedPlatformFeeCents - stripeFee) to the baker, and
// persist the breakdown via `updateFields`. storedPlatformFeeCents falls back
// to 5% of amount_received only for pre-2026-07-28 orders that never got a
// stored fee (amount_received didn't include an added fee back then, so the
// old formula is still correct for those).
async function sweepLeg(
  orderId: string,
  bakerId: string,
  paymentIntentId: string,
  storedPlatformFeeCents: number | null,
  idempotencyKey: string,
  updateFields: (transferId: string, platformFee: number, stripeFee: number, transferAmount: number) => Record<string, unknown>
): Promise<LegResult> {
  if (paymentIntentId.startsWith("mock_")) return { outcome: "skipped_mock" };

  const { data: baker } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
    .eq("id", bakerId)
    .single();

  if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
    return { outcome: "skipped_no_connect" }; // baker hasn't connected Stripe yet — picked up by a future run once they do
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const amountReceived = intent.amount_received ?? 0;
  if (amountReceived <= 0) {
    return { outcome: "error", message: `payment intent has no amount_received (status=${intent.status})` };
  }

  // deno-lint-ignore no-explicit-any
  const charge = intent.latest_charge as any;
  const balanceTxn = charge?.balance_transaction;
  if (!balanceTxn || typeof balanceTxn.fee !== "number") {
    return { outcome: "error", message: "could not read Stripe's balance_transaction fee — skipping payout until it's available" };
  }
  const stripeFee = balanceTxn.fee;

  const platformFee = storedPlatformFeeCents ?? Math.round(amountReceived * PLATFORM_FEE_RATE);
  const transferAmount = Math.max(0, amountReceived - platformFee - stripeFee);

  const transfer = await stripe.transfers.create(
    {
      amount: transferAmount,
      currency: intent.currency,
      destination: baker.stripe_connect_account_id,
      transfer_group: orderId,
      metadata: { order_id: orderId, platform_fee: String(platformFee), stripe_fee: String(stripeFee) },
    },
    { idempotencyKey }
  );

  const { error: updateErr } = await supabase
    .from("orders")
    .update(updateFields(transfer.id, platformFee, stripeFee, transferAmount))
    .eq("id", orderId);

  if (updateErr) {
    return { outcome: "error", message: `transfer ${transfer.id} created but DB update failed: ${updateErr.message}` };
  }

  return { outcome: "transferred", transferAmount };
}

serve(async (req) => {
  const provided = req.headers.get("x-webhook-secret");
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const cutoff = new Date(Date.now() - DISPUTE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const results = {
    main_processed: 0, main_transferred: 0,
    deposit_processed: 0, deposit_transferred: 0,
    skipped_no_connect: 0, skipped_mock: 0,
    errors: [] as string[],
  };

  // ── Leg 1: main/balance charge — every order type, gated on the order's
  // own completion + dispute window. ──
  const { data: mainOrders, error: mainFetchErr } = await supabase
    .from("orders")
    .select("id, user_id, payment_intent_id, platform_fee_cents")
    .eq("payment_status", "captured")
    .eq("marketplace_status", "completed")
    .is("baker_transfer_id", null)
    .not("payment_intent_id", "is", null)
    .or("payment_flow.neq.deposit_and_save,is_paid.eq.true")
    .lte("completed_at", cutoff) as { data: MainLegOrder[] | null; error: unknown };

  if (mainFetchErr) {
    return new Response(JSON.stringify({ error: "Failed to fetch eligible main-leg orders", detail: mainFetchErr }), { status: 500 });
  }

  for (const order of mainOrders ?? []) {
    results.main_processed++;
    try {
      const result = await sweepLeg(
        order.id, order.user_id, order.payment_intent_id, order.platform_fee_cents,
        `payout_${order.id}`,
        (transferId, platformFee, stripeFee, transferAmount) => ({
          baker_transfer_id: transferId,
          baker_transferred_at: new Date().toISOString(),
          platform_fee_cents: platformFee,
          stripe_fee_cents: stripeFee,
          baker_payout_cents: transferAmount,
        })
      );
      if (result.outcome === "transferred") results.main_transferred++;
      else if (result.outcome === "skipped_no_connect") results.skipped_no_connect++;
      else if (result.outcome === "skipped_mock") results.skipped_mock++;
      else results.errors.push(`order ${order.id} (main leg): ${result.message}`);
    } catch (err) {
      results.errors.push(`order ${order.id} (main leg): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Leg 2: deposit charge of deposit_and_save orders — its own dispute
  // window from when the deposit itself was charged, independent of whether
  // the rest of the order has been completed yet. ──
  const { data: depositOrders, error: depositFetchErr } = await supabase
    .from("orders")
    .select("id, user_id, deposit_payment_intent_id, deposit_platform_fee_cents")
    .eq("payment_flow", "deposit_and_save")
    .is("deposit_transfer_id", null)
    .not("deposit_payment_intent_id", "is", null)
    .lte("deposit_charged_at", cutoff) as { data: DepositLegOrder[] | null; error: unknown };

  if (depositFetchErr) {
    return new Response(JSON.stringify({ error: "Failed to fetch eligible deposit-leg orders", detail: depositFetchErr, ...results }), { status: 500 });
  }

  for (const order of depositOrders ?? []) {
    results.deposit_processed++;
    try {
      const result = await sweepLeg(
        order.id, order.user_id, order.deposit_payment_intent_id, order.deposit_platform_fee_cents,
        `deposit_payout_${order.id}`,
        (transferId, platformFee, stripeFee, transferAmount) => ({
          deposit_transfer_id: transferId,
          deposit_platform_fee_cents: platformFee,
          deposit_stripe_fee_cents: stripeFee,
          deposit_baker_payout_cents: transferAmount,
        })
      );
      if (result.outcome === "transferred") results.deposit_transferred++;
      else if (result.outcome === "skipped_no_connect") results.skipped_no_connect++;
      else if (result.outcome === "skipped_mock") results.skipped_mock++;
      else results.errors.push(`order ${order.id} (deposit leg): ${result.message}`);
    } catch (err) {
      results.errors.push(`order ${order.id} (deposit leg): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});
