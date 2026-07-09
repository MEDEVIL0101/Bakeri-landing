import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Called by the static /pay/ web page right after Stripe.js confirms the
// PaymentIntent client-side. Verifies the charge actually succeeded with
// Stripe (never trust the client alone) before marking the order paid.
// Most invoices are paid as a pure guest — no buyer_profile_id, nothing else
// to touch, the baker just sees their manual order flip to paid. But a buyer
// can also claim the same invoice in-app first (via claim_invoice, which sets
// buyer_profile_id + marketplace_status = 'quote_provided') and then pay
// through this web page instead of the in-app flow — in that case we also
// need to flip marketplace_status to 'confirmed', or the app is left showing
// a stale "Quote Received / Review & Pay" for an order that's already paid.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      .select("id, is_paid, payment_intent_id, buyer_profile_id, invoice_type, deposit_amount_cents, deposit_paid_at")
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

    const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${payment_intent_id}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!stripeRes.ok) throw new Error("Could not verify payment with Stripe");
    const intent = await stripeRes.json();
    if (intent.status !== "succeeded") throw new Error(`Payment not confirmed. Status: ${intent.status}`);

    const paidAt = new Date().toISOString();
    // 'full' and 'balance' invoices settle the order; 'deposit' only records
    // the deposit and leaves is_paid false — same full-vs-deposit split as
    // confirm_real_quote_payment for the in-app quote flow.
    const updatePayload: Record<string, unknown> =
      order.invoice_type === "deposit"
        ? {
            payment_status: "authorized",
            deposit_amount: (order.deposit_amount_cents ?? 0) / 100,
            deposit_paid_at: paidAt,
            deposit_note: "Non-refundable deposit",
            updated_at: paidAt,
          }
        : {
            is_paid: true,
            paid_at: paidAt,
            payment_status: "captured",
            payment_note: order.invoice_type === "balance" ? "Balance paid online via invoice link" : "Paid online via invoice link",
            updated_at: paidAt,
          };
    if (order.buyer_profile_id) {
      updatePayload.marketplace_status = "confirmed";
    }
    const { error: updateErr } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id);
    if (updateErr) throw new Error(updateErr.message);

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
