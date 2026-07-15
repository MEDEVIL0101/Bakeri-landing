import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public, unauthenticated endpoint for baker/pay-quote.html, called right
// after Stripe confirms payment client-side. Re-verifies the PaymentIntent's
// live status with Stripe before trusting it — never trusts the client — then
// moves the order straight to "confirmed" (the baker already committed to
// this price when they sent the quote, so no further baker review step is
// needed, unlike a fresh Buy Now order).

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const order_id = String(body.order_id ?? "").trim();
  const payment_intent_id = String(body.payment_intent_id ?? "").trim();
  if (!order_id || !payment_intent_id) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, buyer_profile_id, lead_channel, marketplace_status, is_paid")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) return json({ error: "Quote not found." }, 404);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Quote not found." }, 404);
  }
  if (order.is_paid) {
    // Already finalized (e.g. a retried client call) — idempotent no-op success.
    return json({ ok: true });
  }
  if (order.marketplace_status !== "quote_provided") {
    return json({ error: "This quote is no longer awaiting payment." }, 400);
  }

  const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${payment_intent_id}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!piRes.ok) return json({ error: "Could not verify payment." }, 400);
  const intent = await piRes.json();
  if (intent.status !== "succeeded") {
    return json({ error: "Payment has not completed yet." }, 400);
  }

  const { error: updateErr } = await db
    .from("orders")
    .update({
      is_paid: true,
      paid_at: new Date().toISOString(),
      marketplace_status: "confirmed",
      payment_intent_id,
      payment_status: "authorized",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order_id);

  if (updateErr) {
    console.error("order update failed:", updateErr.message);
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  return json({ ok: true });
});
