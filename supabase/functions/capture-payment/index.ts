import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY       = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET          = Deno.env.get("BAKERI_WEBHOOK_SECRET");

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
      .select("id, payment_intent_id, payment_status")
      .eq("id", order_id)
      .single();

    if (fetchErr || !order) throw new Error("Order not found");
    if (!order.payment_intent_id) throw new Error("No payment intent on this order");

    if (order.payment_status === "captured") {
      return new Response(JSON.stringify({ success: true, already_captured: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Capture the Stripe PaymentIntent
    if (STRIPE_SECRET_KEY) {
      const captureRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${order.payment_intent_id}/capture`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        }
      );

      if (!captureRes.ok) {
        const stripeErr = await captureRes.json();
        // "unexpected_state" means already captured — treat as success
        if (stripeErr.error?.code !== "payment_intent_unexpected_state") {
          throw new Error(stripeErr.error?.message ?? "Stripe capture failed");
        }
      }
    }

    // Only update payment_status — never touch marketplace_status or order status,
    // those are set by confirm_pickup RPC and must not be overwritten here.
    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        payment_status: "captured",
        updated_at: new Date().toISOString(),
      })
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
