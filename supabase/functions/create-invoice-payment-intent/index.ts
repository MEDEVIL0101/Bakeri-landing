import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE, calcDirectChargeApplicationFee } from "../_shared/fees.ts";
import { currencyForCountry } from "../_shared/currency.ts";

// Guest-payment entry point for the pay-by-invoice-code feature. Callable with
// only the anon key (no user session) — the static web page at /pay/ has no
// Supabase auth context, so this function does everything via the service
// role internally, keyed purely on the invoice code the customer was given.

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
    const { invoice_code }: { invoice_code: string } = await req.json();
    const code = (invoice_code ?? "").trim().toUpperCase();
    if (!code) throw new Error("Missing invoice code");

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, due_date, is_paid, buyer_profile_id, created_at, invoice_type, deposit_amount_cents, deposit_paid_at, quoted_price")
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
    // A custom/marketplace order's order_items still reflect the listing's
    // original starting price (e.g. "from $42") captured when the quote
    // request was first made — once the baker actually quotes the customer a
    // different price, quoted_price is the real total and must win. Same
    // fallback as Order.swift's effectiveTotal and charge-balance-payment.
    const quotedPrice = Number(order.quoted_price ?? 0);
    const effectiveTotalCents = quotedPrice > 0 ? Math.round(quotedPrice * 100) : itemsTotalCents;
    if (effectiveTotalCents <= 0) throw new Error("no_amount_due");

    const invoiceType = order.invoice_type ?? "full";
    const depositCents = order.deposit_amount_cents ?? 0;

    let baseAmountCents: number;
    if (invoiceType === "deposit") {
      if (depositCents <= 0) throw new Error("no_deposit_amount_set");
      baseAmountCents = depositCents;
    } else if (invoiceType === "balance") {
      if (!order.deposit_paid_at) throw new Error("no_deposit_on_file");
      baseAmountCents = effectiveTotalCents - depositCents;
      if (baseAmountCents <= 0) throw new Error("no_amount_due");
    } else {
      baseAmountCents = effectiveTotalCents;
    }
    // Guest/website payer (this endpoint only ever serves someone without a
    // buyer_profile_id — see the already_claimed check above): Bakeri's fee
    // is never added to what they pay, it comes out of the baker's cut only,
    // same policy as create-guest-quote-payment-intent/charge-balance-payment
    // — see _shared/fees.ts.
    const platformFeeCents = Math.round(baseAmountCents * PLATFORM_FEE_RATE);
    const amountCents = baseAmountCents;

    const { data: baker } = await supabase
      .from("profiles")
      .select("business_name, user_name, profile_slug, stripe_connect_account_id, stripe_connect_onboarding_complete, country")
      .eq("id", order.user_id)
      .single();
    const bakerName = baker?.business_name?.trim() || baker?.user_name?.trim() || "Baker";

    if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
      throw new Error("This baker hasn't finished setting up payments yet. Check back soon!");
    }
    const connectedAccountId = baker.stripe_connect_account_id;

    // Direct charge: created on the baker's own connected account, so funds
    // settle instantly and Stripe's fee comes out of the baker's balance
    // automatically. application_fee_amount is shrunk so the baker only ever
    // bears Stripe's fee on their own price, not on Bakeri's cut riding along
    // in the same charge — see calcDirectChargeApplicationFee.
    const createParams: Record<string, unknown> = {
      amount: amountCents,
      currency: currencyForCountry(baker.country),
      capture_method: "automatic",
      automatic_payment_methods: { enabled: true },
      application_fee_amount: calcDirectChargeApplicationFee(amountCents, platformFeeCents),
      metadata: {
        order_id: order.id,
        invoice_code: code,
        source: "invoice_web",
        invoice_type: invoiceType,
      },
    };
    if (invoiceType === "deposit") {
      // Save the card so the baker can collect the balance later via a
      // balance-type invoice, reusing this same payment method (charged
      // against the same connected account, since deposit and balance are
      // always the same baker).
      createParams.setup_future_usage = "off_session";
    }

    // deno-lint-ignore no-explicit-any
    const intent = await stripe.paymentIntents.create(createParams as any, { stripeAccount: connectedAccountId });

    await supabase.from("orders").update({
      payment_intent_id: intent.id,
      payment_model: "direct",
    }).eq("id", order.id);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        baker_id: order.user_id,
        profile_slug: baker?.profile_slug ?? null,
        client_secret: intent.client_secret,
        amount_cents: amountCents,
        platform_fee_cents: platformFeeCents,
        invoice_type: invoiceType,
        baker_name: bakerName,
        stripe_connect_account_id: connectedAccountId,
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
