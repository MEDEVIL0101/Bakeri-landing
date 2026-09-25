import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { calcPlatformFeeCents, calcDirectChargeApplicationFee, STRIPE_FEE_ESTIMATE } from "../_shared/fees.ts";
import { currencyForCountry } from "../_shared/currency.ts";

// Creates a card_present PaymentIntent for an in-person Tap to Pay charge —
// either against an existing manual order (order_id set) or a standalone
// walk-up/market sale (order_id omitted). Same direct-charge shape as
// pay-quote-order: created directly on the baker's connected account so
// funds settle instantly, with Bakeri's 5% taken via application_fee_amount.
// Unlike pay-quote-order, the baker (not a buyer) initiates this charge and
// there's no checkout screen to disclose an added fee on, so the baker
// absorbs the single 5% cut — no doubling. Fee model mirrors pay-invoice-order
// exactly (application_fee_amount shrunk via calcDirectChargeApplicationFee so
// Bakeri, not the baker, eats the percentage-based Stripe fee on its own cut).
//
// Tips (2026-09-24): the baker keeps 100% of a tip. tip_cents is included in
// amount_cents (it's one card charge) but excluded from the 5% platform-fee
// base, and Bakeri also absorbs Stripe's estimated percentage fee on the tip
// by shrinking application_fee_amount further — floored at 0, so on a tiny
// sale with an outsized tip Bakeri's whole cut is the most it can cover.
// Stripe's flat per-charge fee stays with the baker, same as every other
// charge (see calcDirectChargeApplicationFee). The tip is capped at the
// pre-tip sale amount so a sale can't be relabelled as a fee-free "tip".

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

interface RequestBody {
  amount_cents: number;
  tip_cents?: number;
  order_id?: string;
  description?: string;
}

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
    const { amount_cents, tip_cents: rawTip, order_id, description }: RequestBody = await req.json();

    if (!amount_cents || amount_cents <= 0 || !Number.isInteger(amount_cents)) {
      throw new Error("Invalid amount");
    }
    const tip_cents = rawTip ?? 0;
    if (!Number.isInteger(tip_cents) || tip_cents < 0) {
      throw new Error("Invalid tip");
    }
    const saleCents = amount_cents - tip_cents;
    if (saleCents <= 0 || tip_cents > saleCents) {
      throw new Error("Tip can't be more than the sale amount");
    }

    const { data: baker } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete, country")
      .eq("id", user.id)
      .single();

    if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
      throw new Error("Finish setting up Stripe before using Tap to Pay.");
    }
    const connectedAccountId = baker.stripe_connect_account_id;

    // If charging an existing order, verify the baker actually owns it and
    // it isn't already paid — prevents a stale/duplicate Tap to Pay charge
    // on an order that was already settled another way.
    if (order_id) {
      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .select("id, user_id, is_paid")
        .eq("id", order_id)
        .single();
      if (orderErr || !order) throw new Error("Order not found");
      if (order.user_id !== user.id) throw new Error("Forbidden");
      if (order.is_paid) throw new Error("This order is already paid");
    }

    const platformFeeCents = calcPlatformFeeCents(saleCents);
    const bakeriCoversTipStripeFee = Math.round(tip_cents * STRIPE_FEE_ESTIMATE.pct);
    const applicationFeeCents = Math.max(
      0,
      calcDirectChargeApplicationFee(amount_cents, platformFeeCents) - bakeriCoversTipStripeFee,
    );

    const metadata: Record<string, string> = {
      baker_id: user.id,
      source: "tap_to_pay",
    };
    if (order_id) metadata.order_id = order_id;
    if (description) metadata.description = description;
    if (tip_cents > 0) metadata.tip_cents = String(tip_cents);

    const intent = await stripe.paymentIntents.create(
      {
        amount: amount_cents,
        currency: currencyForCountry(baker.country),
        payment_method_types: ["card_present"],
        capture_method: "automatic",
        application_fee_amount: applicationFeeCents,
        metadata,
      },
      { stripeAccount: connectedAccountId }
    );

    return new Response(
      JSON.stringify({
        payment_intent_id: intent.id,
        client_secret: intent.client_secret,
        amount_cents,
        tip_cents,
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
