import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { readDirectChargeSettlement, toDepositSettlementFields } from "../_shared/settlement.ts";
import { sendGuestPaymentReceiptEmail } from "../_shared/guestReceiptEmail.ts";

// Called by the static /pay/ web page right after Stripe.js confirms the
// PaymentIntent client-side. Verifies the charge actually succeeded with
// Stripe (never trust the client alone) before marking the order paid.
// order_source is fixed at order creation and never changes here (or
// anywhere else post-creation) — a manual order stays manual even once a
// buyer claims + pays its invoice in-app (claim_invoice only attaches
// buyer_profile_id, it doesn't touch order_source). marketplace_status is
// only ever set below for the rare invoice that was already order_source
// 'marketplace' at creation.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { invoice_code, payment_intent_id }: { invoice_code: string; payment_intent_id?: string } = await req.json();
    const code = (invoice_code ?? "").trim().toUpperCase();
    if (!code) throw new Error("Missing invoice_code");
    if (!payment_intent_id) throw new Error("Missing payment_intent_id");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, is_paid, payment_intent_id, payment_model, order_source, invoice_type, deposit_amount_cents, deposit_paid_at, quoted_price, marketplace_status")
      .eq("invoice_code", code)
      .single();

    if (orderErr || !order) throw new Error("not_found");
    if (order.is_paid) {
      return new Response(JSON.stringify({ ok: true, already_paid: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    // A deposit invoice doesn't set is_paid — guard separately so it can't be
    // paid twice via two different browser tabs/retries.
    if (order.invoice_type === "deposit" && order.deposit_paid_at) {
      return new Response(JSON.stringify({ ok: true, already_paid: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (order.payment_intent_id !== payment_intent_id) throw new Error("payment_intent_mismatch");

    const isDirect = order.payment_model === "direct";
    let connectedAccountId: string | null = null;
    if (isDirect) {
      const { data: baker } = await supabase
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", order.user_id)
        .single();
      connectedAccountId = baker?.stripe_connect_account_id ?? null;
    }

    let intent;
    try {
      intent = connectedAccountId
        ? await stripe.paymentIntents.retrieve(payment_intent_id, { stripeAccount: connectedAccountId })
        : await stripe.paymentIntents.retrieve(payment_intent_id);
    } catch {
      throw new Error("Could not verify payment with Stripe");
    }
    if (intent.status !== "succeeded") throw new Error(`Payment not confirmed. Status: ${intent.status}`);

    // Recompute the pre-fee base amount for whichever leg this is, to derive
    // the exact platform fee already baked into what Stripe just charged —
    // same bases create-invoice-payment-intent used (including its
    // quoted_price-over-order_items fallback for a custom/marketplace quote,
    // and no fee added on top — this endpoint's payer never has a
    // buyer_profile_id, i.e. always a guest, so Bakeri's cut always comes out
    // of the baker's side only).
    const depositCents = order.deposit_amount_cents ?? 0;
    let baseAmountCents = depositCents;
    if (order.invoice_type !== "deposit") {
      const { data: items } = await supabase
        .from("order_items")
        .select("quantity, price_per_unit")
        .eq("order_id", order.id)
        .is("deleted_at", null);
      const itemsTotalCents = Math.round(
        (items ?? []).reduce((sum: number, i: { quantity: number; price_per_unit: number }) => sum + i.quantity * i.price_per_unit, 0) * 100
      );
      const quotedPrice = Number(order.quoted_price ?? 0);
      const effectiveTotalCents = quotedPrice > 0 ? Math.round(quotedPrice * 100) : itemsTotalCents;
      baseAmountCents = order.invoice_type === "balance" ? effectiveTotalCents - depositCents : effectiveTotalCents;
    }
    const platformFeeCents = Math.round(baseAmountCents * PLATFORM_FEE_RATE);

    // Direct charge already settled instantly — read the real Stripe fee now
    // so this closes the payout loop immediately instead of waiting on
    // release-baker-payouts (whose sweep only runs for platform_custody
    // orders).
    const settlement = connectedAccountId
      ? await readDirectChargeSettlement(stripe, payment_intent_id, connectedAccountId, platformFeeCents)
      : null;

    const paidAt = new Date().toISOString();
    // 'full' and 'balance' invoices settle the order; 'deposit' only records
    // the deposit and leaves is_paid false — same full-vs-deposit split as
    // confirm_real_quote_payment for the in-app quote flow. The deposit leg
    // gets its own tracking columns (mirroring the cart/quote deposit flows)
    // since release-baker-payouts sweeps it separately, on its own 24h timer
    // starting now rather than waiting for the whole order to complete
    // (platform_custody orders only — a direct charge's deposit settlement is
    // recorded immediately below instead).
    const updatePayload: Record<string, unknown> =
      order.invoice_type === "deposit"
        ? {
            // 2026-08-07 fix: this used to say "authorized", the same status
            // the setup_intent/auth_hold flows use for an uncaptured hold —
            // but an invoice deposit is a real direct charge, captured
            // immediately (deposit_charged_at, below), not a hold. "authorized"
            // made the baker's Payment card read "Payment held — captured at
            // pickup" for money that had already actually moved. payment_flow
            // "deposit_and_save" matches this order onto the same
            // deposit-then-balance display manual orders already use.
            payment_status: "deposit_paid",
            payment_flow: "deposit_and_save",
            deposit_amount: (order.deposit_amount_cents ?? 0) / 100,
            deposit_paid_at: paidAt,
            deposit_note: "Non-refundable deposit",
            deposit_payment_intent_id: payment_intent_id,
            deposit_charged_at: paidAt,
            deposit_platform_fee_cents: platformFeeCents,
            updated_at: paidAt,
            ...(settlement ? toDepositSettlementFields(settlement) : {}),
          }
        : {
            is_paid: true,
            paid_at: paidAt,
            payment_status: "captured",
            payment_note: order.invoice_type === "balance" ? "Balance paid online via invoice link" : "Paid online via invoice link",
            platform_fee_cents: platformFeeCents,
            // order_source is immutable after creation (claim_invoice no
            // longer flips it — see 20260805000003_order_source_immutable)
            // so an invoiced order is 'marketplace' here only if it was
            // created that way in the first place (rare — a baker can
            // generate an invoice_code on any order regardless of source,
            // and every quote-based custom order is 'marketplace' from
            // creation, so a balance invoice on one of those hits this too).
            // 2026-08-07 fix: this used to jump straight to 'completed' —
            // paying the balance is NOT the same as the order being picked
            // up/fulfilled, but this made a paid balance instantly disappear
            // off the baker's active Orders list as if it had been. Fixed to
            // only ever ADVANCE the order to 'confirmed' (a payment-status
            // milestone, matching what finalize-guest-quote-payment already
            // sets after a quote deposit/full payment) from a pre-payment
            // marketplace_status, and never touch it once the baker has
            // already progressed it further (ready_for_pickup/completed) or
            // moved it terminal (cancelled/declined) — fulfillment stays the
            // baker's own manual Mark Ready -> Mark Completed action, never
            // implied by a payment event. Still NULL-for-manual by schema
            // constraint, so this never regresses to NULL either.
            ...(order.order_source === "marketplace" &&
              ["pending", "pending_quote", "quote_provided", null].includes(order.marketplace_status)
              ? { marketplace_status: "confirmed" }
              : {}),
            updated_at: paidAt,
            ...(settlement ?? {}),
          };
    const { error: updateErr } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id);
    if (updateErr) throw new Error(updateErr.message);

    // Best-effort — never let a receipt-email failure surface as a failed
    // payment. invoice_type is already exactly "deposit"/"balance"/"full".
    await sendGuestPaymentReceiptEmail(supabase, {
      orderId: order.id,
      leg: (order.invoice_type ?? "full") as "deposit" | "balance" | "full",
      amountCents: baseAmountCents,
      paidAtIso: paidAt,
    });

    return new Response(JSON.stringify({ ok: true, paid_at: paidAt }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
