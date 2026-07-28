import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Guest-payment entry point for the pay-by-invoice-code feature. Callable with
// only the anon key (no user session) — the static web page at /pay/ has no
// Supabase auth context, so this function does everything via the service
// role internally, keyed purely on the invoice code the customer was given.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Fee added on top of what the customer pays, not deducted from the baker's
// payout — matches every other checkout path.
const PLATFORM_FEE_RATE = 0.05;

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
    const { invoice_code }: { invoice_code: string } = await req.json();
    const code = (invoice_code ?? "").trim().toUpperCase();
    if (!code) throw new Error("Missing invoice code");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, due_date, is_paid, buyer_profile_id, created_at, invoice_type, deposit_amount_cents, deposit_paid_at")
      .eq("invoice_code", code)
      .single();

    if (orderErr || !order) throw new Error("not_found");
    if (order.is_paid) throw new Error("already_paid");
    if (order.buyer_profile_id) throw new Error("already_claimed");
    // Deposit invoices don't set is_paid, so that check alone won't catch a
    // deposit that's already been collected — guard it separately.
    if ((order.invoice_type ?? "full") === "deposit" && order.deposit_paid_at) {
      throw new Error("already_paid");
    }

    const { data: items } = await supabase
      .from("order_items")
      .select("custom_name, quantity, price_per_unit")
      .eq("order_id", order.id)
      .is("deleted_at", null);

    const itemsTotalCents = Math.round(
      (items ?? []).reduce(
        (sum: number, i: { quantity: number; price_per_unit: number }) => sum + i.quantity * i.price_per_unit,
        0
      ) * 100
    );
    if (itemsTotalCents <= 0) throw new Error("no_amount_due");

    const invoiceType = order.invoice_type ?? "full";
    const depositCents = order.deposit_amount_cents ?? 0;

    let baseAmountCents: number;
    if (invoiceType === "deposit") {
      if (depositCents <= 0) throw new Error("no_deposit_amount_set");
      baseAmountCents = depositCents;
    } else if (invoiceType === "balance") {
      if (!order.deposit_paid_at) throw new Error("no_deposit_on_file");
      baseAmountCents = itemsTotalCents - depositCents;
      if (baseAmountCents <= 0) throw new Error("no_amount_due");
    } else {
      baseAmountCents = itemsTotalCents;
    }
    // Fee added on top of what the customer pays, not deducted from the
    // baker's payout.
    const platformFeeCents = Math.round(baseAmountCents * PLATFORM_FEE_RATE);
    const amountCents = baseAmountCents + platformFeeCents;

    const { data: baker } = await supabase
      .from("profiles")
      .select("business_name, user_name, stripe_connect_account_id, stripe_connect_onboarding_complete")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Baker";

    const intentParams: Record<string, string> = {
      amount: amountCents.toString(),
      currency: "cad",
      capture_method: "automatic",
      "automatic_payment_methods[enabled]": "true",
      // Stripe's form-encoded API wants metadata as bracket-notation fields,
      // not a JSON string under a single "metadata" key.
      "metadata[order_id]": order.id,
      "metadata[invoice_code]": code,
      "metadata[source]": "invoice_web",
      "metadata[invoice_type]": invoiceType,
    };
    if (invoiceType === "deposit") {
      // No application_fee_amount/transfer_data here — the deposit charges
      // into Bakeri's own balance like every other order, and is later swept
      // to the baker by release-baker-payouts using deposit_payment_intent_id
      // (snapshotted below, before the balance invoice overwrites
      // payment_intent_id) once its own 24h dispute window passes.
      //
      // Save the card so the baker can collect the balance later via a
      // balance-type invoice, reusing this same payment method.
      intentParams["setup_future_usage"] = "off_session";
    }

    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(intentParams).toString(),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.text();
      throw new Error(`Stripe error: ${err}`);
    }
    const intent = await stripeRes.json();

    await supabase.from("orders").update({ payment_intent_id: intent.id }).eq("id", order.id);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        baker_id: order.user_id,
        client_secret: intent.client_secret,
        amount_cents: amountCents,
        platform_fee_cents: platformFeeCents,
        invoice_type: invoiceType,
        baker_name: bakerName,
        // Customer-facing item list — deliberately not order_name, which is a
        // baker-internal label that may not be meant for the customer to see.
        items: (items ?? []).map((i: { custom_name: string; quantity: number; price_per_unit: number }) => ({
          name: i.custom_name,
          quantity: i.quantity,
          price_per_unit: i.price_per_unit,
        })),
        due_date: order.due_date,
        created_at: order.created_at,
      }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
