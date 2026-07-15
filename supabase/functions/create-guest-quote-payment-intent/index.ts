import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public, unauthenticated endpoint for baker/pay-quote.html — lets a guest
// (no Bakeri account) pay the price a baker quoted them for a custom order
// request. Mirrors create-payment-intent's "immediate" flow (captures into
// Bakeri's own balance; released to the baker later by release-baker-payouts)
// but keyed by an existing order rather than a fresh cart.
//
// Scope decision: charges the full quoted_price in one shot, even if the
// baker split it into deposit+balance when quoting — a guest has no saved
// payment method for the existing deposit_and_save (charge deposit now, save
// card, charge balance later off-session) flow to defer onto. Collecting any
// remaining balance for a guest order after this is a manual follow-up
// (baker can generate/send another invoice) rather than automatic.

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
  if (!order_id) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, user_id, quoted_price, marketplace_status, buyer_profile_id, lead_channel, is_paid")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) return json({ error: "Quote not found." }, 404);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Quote not found." }, 404);
  }
  if (order.is_paid || order.marketplace_status !== "quote_provided") {
    return json({ error: "This quote is no longer awaiting payment." }, 400);
  }
  const quotedPrice = Number(order.quoted_price ?? 0);
  if (!(quotedPrice > 0)) return json({ error: "This quote has no amount set." }, 400);

  const chargeCents = Math.round(quotedPrice * 100);

  const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      amount: String(chargeCents),
      currency: "cad",
      capture_method: "automatic",
      "automatic_payment_methods[enabled]": "true",
      "metadata[order_id]": order.id,
      "metadata[baker_id]": order.user_id,
      "metadata[flow]": "guest_quote_payment",
    }),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json();
    return json({ error: err.error?.message ?? "Stripe error" }, 400);
  }
  const intent = await stripeRes.json();

  return json({
    payment_intent_id: intent.id,
    client_secret: intent.client_secret,
    amount_cents: chargeCents,
  });
});
