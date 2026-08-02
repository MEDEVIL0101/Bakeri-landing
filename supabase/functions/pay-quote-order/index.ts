import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Verify buyer owns this order and it is in quote_provided state
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, quoted_price, deposit_amount_cents, buyer_profile_id, marketplace_status")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) throw new Error("Order not found");
    if (order.buyer_profile_id !== user.id) throw new Error("Forbidden");
    if (order.marketplace_status !== "quote_provided") throw new Error("Order is not in quote_provided state");
    if (!order.quoted_price || order.quoted_price <= 0) throw new Error("No valid quoted price");

    const { data: baker } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
      .eq("id", order.user_id)
      .single();
    if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
      throw new Error("This baker hasn't finished setting up payments yet. Check back soon!");
    }
    const connectedAccountId = baker.stripe_connect_account_id;

    const totalCents = Math.round(order.quoted_price * 100);
    const depositCents = order.deposit_amount_cents ?? 0;
    // A deposit less than the full total means only the deposit is due now —
    // the balance gets collected later via charge-balance-payment, off the
    // saved card from this same intent (setup_future_usage below).
    const isPartialDeposit = depositCents > 0 && depositCents < totalCents;
    const baseAmountCents = isPartialDeposit ? depositCents : totalCents;
    // In-app order: the fee is added on top of what the buyer pays AND taken
    // from the baker's quoted price — both sides pay (2026-08-02). Since the
    // charge amount already embeds one 5% cut (the buyer's), the
    // application_fee_amount taken from it must be *two* fee-worths — one to
    // actually collect that embedded customer cut, one more carved out of
    // the baker's own base — or the two would just cancel out and the baker
    // would net exactly what they did before this decision.
    const platformFeeCents = Math.round(baseAmountCents * PLATFORM_FEE_RATE);
    const amountCents = baseAmountCents + platformFeeCents;

    // Direct charge: created on the baker's own connected account, so funds
    // settle instantly and Stripe's fee comes out of the baker's balance
    // automatically.
    const createParams: Record<string, unknown> = {
      amount: amountCents,
      currency: "cad",
      capture_method: "automatic",
      application_fee_amount: platformFeeCents * 2,
      metadata: { order_id, charge_type: isPartialDeposit ? "quote_deposit" : "quote_full" },
    };
    if (isPartialDeposit) {
      createParams.setup_future_usage = "off_session";
    }

    // deno-lint-ignore no-explicit-any
    const intent = await stripe.paymentIntents.create(createParams as any, { stripeAccount: connectedAccountId });

    // Store payment_intent_id on the order
    await supabase
      .from("orders")
      .update({ payment_intent_id: intent.id, payment_status: "pending", payment_model: "direct" })
      .eq("id", order_id);

    return new Response(
      JSON.stringify({
        payment_intent_id: intent.id,
        client_secret: intent.client_secret,
        amount_cents: amountCents,
        platform_fee_cents: platformFeeCents,
        stripe_connect_account_id: connectedAccountId,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
