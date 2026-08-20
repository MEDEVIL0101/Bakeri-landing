import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { readDirectChargeSettlement } from "../_shared/settlement.ts";

const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET          = Deno.env.get("BAKERI_WEBHOOK_SECRET");

const stripe = getStripeClient();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-webhook-secret, content-type",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let fromWebhook = false;

  // Auth: accept either a user JWT or the server-side webhook secret
  const webhookHeader = req.headers.get("x-webhook-secret");
  if (webhookHeader && WEBHOOK_SECRET && webhookHeader === WEBHOOK_SECRET) {
    fromWebhook = true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
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

    // Verify baker owns the order
    const { order_id: checkID }: { order_id: string } = await req.clone().json();
    const { data: ownerRow } = await supabase
      .from("orders")
      .select("user_id")
      .eq("id", checkID)
      .single();
    if (!ownerRow || ownerRow.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { order_id }: { order_id: string } = await req.json();
    if (!order_id) throw new Error("order_id is required");

    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, user_id, payment_intent_id, payment_status, payment_model, platform_fee_cents")
      .eq("id", order_id)
      .single();

    if (fetchErr || !order) throw new Error("Order not found");
    if (!order.payment_intent_id) throw new Error("No payment intent on this order");

    if (order.payment_status === "captured") {
      return new Response(JSON.stringify({ success: true, already_captured: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

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
    const stripeOpts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

    // Capture the Stripe PaymentIntent
    try {
      await stripe.paymentIntents.capture(order.payment_intent_id, {}, stripeOpts);
    } catch (err: unknown) {
      // "unexpected_state" means already captured — treat as success
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.code ?? (err as any)?.raw?.code;
      if (code !== "payment_intent_unexpected_state") {
        throw new Error(err instanceof Error ? err.message : "Stripe capture failed");
      }
    }

    const updateFields: Record<string, unknown> = {
      payment_status: "captured",
      updated_at: new Date().toISOString(),
    };

    if (isDirect && connectedAccountId) {
      // Direct charge just settled — record the real Stripe fee now so this
      // closes the payout loop immediately instead of waiting on
      // release-baker-payouts (whose sweep only runs for platform_custody
      // orders, and this order will never match it anyway).
      const settlement = await readDirectChargeSettlement(
        stripe,
        order.payment_intent_id,
        connectedAccountId,
        order.platform_fee_cents ?? 0
      );
      if (settlement) Object.assign(updateFields, settlement);
    }

    // Only update payment_status (and, for direct orders, the settlement
    // fields above) — never touch marketplace_status or order status, those
    // are set by confirm_pickup RPC and must not be overwritten here.
    const { error: updateErr } = await supabase
      .from("orders")
      .update(updateFields)
      .eq("id", order_id);

    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
