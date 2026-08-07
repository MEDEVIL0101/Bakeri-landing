import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE, calcDirectChargeApplicationFee } from "../_shared/fees.ts";
import { currencyForCountry } from "../_shared/currency.ts";

// Authenticated in-app counterpart to create-invoice-payment-intent (the
// guest/web version). A buyer who claimed an invoice in-app (claim_invoice —
// sets buyer_profile_id, never touches order_source) pays it for real here,
// via the same Stripe Connect direct-charge pattern as pay-quote-order.
// Replaces claim_and_pay_invoice, which never called Stripe at all — see
// 20260805000004_drop_mock_claim_and_pay_invoice.sql.
//
// Fee model mirrors create-invoice-payment-intent exactly (Bakeri's fee
// comes out of the baker's own cut, never added on top of what the customer
// pays — application_fee_amount shrunk via calcDirectChargeApplicationFee) —
// NOT pay-quote-order's "both sides pay" doubled fee, since that's specific
// to in-app marketplace quote orders. An invoice must charge the same total
// and take the same cut whether it's paid by a guest on the web or a buyer
// in the app.

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { order_id }: { order_id: string } = await req.json();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, is_paid, buyer_profile_id, invoice_code, invoice_type, deposit_amount_cents, deposit_paid_at, quoted_price")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (!order.invoice_code) throw new Error("Not an invoice order");
    if (order.buyer_profile_id !== user.id) throw new Error("Forbidden — claim this invoice first");
    if (order.is_paid) throw new Error("already_paid");
    const invoiceType = order.invoice_type ?? "full";
    if (invoiceType === "deposit" && order.deposit_paid_at) throw new Error("already_paid");

    const { data: items } = await supabase
      .from("order_items")
      .select("quantity, price_per_unit")
      .eq("order_id", order.id)
      .is("deleted_at", null);

    const itemsTotalCents = Math.round(
      (items ?? []).reduce(
        (sum: number, i: { quantity: number; price_per_unit: number }) => sum + i.quantity * i.price_per_unit,
        0
      ) * 100
    );
    // Same quoted_price-over-order_items fallback as create-invoice-payment-intent
    // and get_invoice_preview — a custom/marketplace order's order_items still
    // reflect the listing's original "from $X" price; once the baker actually
    // quotes a different price, quoted_price is the real total and must win.
    const quotedPrice = Number(order.quoted_price ?? 0);
    const effectiveTotalCents = quotedPrice > 0 ? Math.round(quotedPrice * 100) : itemsTotalCents;
    if (effectiveTotalCents <= 0) throw new Error("no_amount_due");

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
    // Bakeri's fee comes out of the baker's own cut, never added on top of
    // what the customer pays — same policy as create-invoice-payment-intent.
    const platformFeeCents = Math.round(baseAmountCents * PLATFORM_FEE_RATE);
    const amountCents = baseAmountCents;

    const { data: baker } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete, country")
      .eq("id", order.user_id)
      .single();
    if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
      throw new Error("This baker hasn't finished setting up payments yet. Check back soon!");
    }
    const connectedAccountId = baker.stripe_connect_account_id;

    const createParams: Record<string, unknown> = {
      amount: amountCents,
      currency: currencyForCountry(baker.country),
      capture_method: "automatic",
      automatic_payment_methods: { enabled: true },
      application_fee_amount: calcDirectChargeApplicationFee(amountCents, platformFeeCents),
      metadata: {
        order_id: order.id,
        invoice_code: order.invoice_code,
        source: "invoice_app",
        invoice_type: invoiceType,
      },
    };
    if (invoiceType === "deposit") {
      createParams.setup_future_usage = "off_session";
    }

    // deno-lint-ignore no-explicit-any
    const intent = await stripe.paymentIntents.create(createParams as any, { stripeAccount: connectedAccountId });

    await supabase
      .from("orders")
      .update({ payment_intent_id: intent.id, payment_model: "direct" })
      .eq("id", order.id);

    return new Response(
      JSON.stringify({
        payment_intent_id: intent.id,
        client_secret: intent.client_secret,
        amount_cents: amountCents,
        platform_fee_cents: platformFeeCents,
        stripe_connect_account_id: connectedAccountId,
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
