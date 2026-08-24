import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { friendlyStripeError } from "../_shared/stripeErrors.ts";
import { currencyForCountry } from "../_shared/currency.ts";

// Public, unauthenticated endpoint for baker/pay-quote.html — lets a guest
// (no Bakeri account) pay the price a baker quoted them for a custom order
// request. Charges a Stripe Connect direct charge on the baker's own account
// (funds settle instantly; Stripe's fee comes off the baker's balance) but
// keyed by an existing order rather than a fresh cart.
//
// 2026-08-07 fix: a guest has no session/saved payment method for the
// deposit_and_save (charge deposit now, save card, charge balance
// off-session) flow the in-app cart uses, so this previously charged the
// FULL quoted_price even when the baker had quoted a deposit+balance split —
// silently overcharging the guest relative to what the baker configured
// (see Tilly's Sugar Cookies incident, order 9c8de489-4e05-46a8-8f1b-cb024953c881).
// Now: if the order has a genuine partial deposit set, charge only the
// deposit. Collecting the balance afterward is a manual follow-up — the
// baker sends a second payment link (invoice_code, 'balance' type), which
// already exists as its own flow (create-invoice-payment-intent).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

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
    .select("id, user_id, quoted_price, marketplace_status, buyer_profile_id, lead_channel, is_paid, deposit_amount_cents")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) return json({ error: "Quote not found." }, 404);
  if (order.buyer_profile_id !== null || order.lead_channel !== "website") {
    return json({ error: "Quote not found." }, 404);
  }
  if (order.is_paid || order.marketplace_status !== "quote_provided") {
    return json({ error: "This quote is no longer awaiting payment." }, 400);
  }

  const { data: bakerProfile } = await db
    .from("profiles")
    .select("business_name, user_name, stripe_connect_account_id, stripe_connect_onboarding_complete, country")
    .eq("id", order.user_id)
    .single();
  if (!bakerProfile?.stripe_connect_onboarding_complete || !bakerProfile?.stripe_connect_account_id) {
    const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "This baker";
    return json({ error: `${bakerDisplayName} hasn't finished setting up payments yet. Check back soon!` }, 400);
  }
  const connectedAccountId = bakerProfile.stripe_connect_account_id;

  const quotedPrice = Number(order.quoted_price ?? 0);
  if (!(quotedPrice > 0)) return json({ error: "This quote has no amount set." }, 400);

  // Website/guest orders: the buyer pays exactly the quoted price (or just
  // the deposit, below) — Bakeri's service charge comes out of the baker's
  // cut instead (application_fee_amount below), not added on top. See
  // _shared/fees.ts.
  const fullCents = Math.round(quotedPrice * 100);
  const depositCents = order.deposit_amount_cents ?? 0;
  // A "genuine" deposit is a positive amount strictly less than the total —
  // 0 means no deposit was configured, and >= the total means the baker
  // effectively quoted full payment through the deposit field.
  const isPartialDeposit = depositCents > 0 && depositCents < fullCents;
  const chargeCents = isPartialDeposit ? depositCents : fullCents;
  const platformFeeCents = Math.round(chargeCents * PLATFORM_FEE_RATE);

  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: chargeCents,
        currency: currencyForCountry(bakerProfile.country),
        capture_method: "automatic",
        automatic_payment_methods: { enabled: true },
        application_fee_amount: platformFeeCents,
        metadata: {
          order_id: order.id,
          baker_id: order.user_id,
          flow: "guest_quote_payment",
          leg: isPartialDeposit ? "deposit" : "full",
        },
      },
      { stripeAccount: connectedAccountId }
    );
  } catch (err: unknown) {
    return json({ error: friendlyStripeError(err) }, 400);
  }

  return json({
    payment_intent_id: intent.id,
    client_secret: intent.client_secret,
    amount_cents: chargeCents,
    platform_fee_cents: platformFeeCents,
    stripe_connect_account_id: connectedAccountId,
    is_deposit: isPartialDeposit,
  });
});
