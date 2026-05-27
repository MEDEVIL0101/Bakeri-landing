import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Creates a Stripe SetupIntent to securely save a card without charging it.
// Used for pre-sale orders with pickup more than 7 days away.
// The server will place an authorization hold ~6 days before pickup.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

interface CartItemPayload {
  baker_id: string;
  name: string;
  quantity: number;
  price_from: number;
  listing_kind: string;
  pickup_date?: string | null;
}

interface RequestBody {
  items: CartItemPayload[];
  currency?: string;
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

  try {
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const { items, currency = "cad" }: RequestBody = await req.json();

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No items" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const fullTotalCents = Math.round(
      items.reduce((sum, item) => sum + item.price_from * item.quantity, 0) * 100
    );

    const bakerIDs = [...new Set(items.map((i) => i.baker_id))];

    // Determine scheduled_hold_at: 6 days before earliest pickup date
    const pickupDates = items
      .filter((i) => i.pickup_date)
      .map((i) => new Date(i.pickup_date!).getTime());
    const earliestPickup = pickupDates.length > 0 ? Math.min(...pickupDates) : null;
    const scheduledHoldAt = earliestPickup
      ? new Date(earliestPickup - 6 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const stripeRes = await fetch("https://api.stripe.com/v1/setup_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        usage: "off_session",
        "automatic_payment_methods[enabled]": "true",
        "metadata[baker_ids]": bakerIDs.join(","),
        "metadata[full_amount_cents]": String(fullTotalCents),
        "metadata[currency]": currency,
        "metadata[payment_flow]": "setup_intent",
        ...(scheduledHoldAt ? { "metadata[scheduled_hold_at]": scheduledHoldAt } : {}),
      }),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json();
      throw new Error(err.error?.message ?? "Stripe error");
    }

    const intent = await stripeRes.json();

    return new Response(
      JSON.stringify({
        setup_intent_id: intent.id,
        client_secret: intent.client_secret,
        full_amount_cents: fullTotalCents,
        payment_flow: "setup_intent",
        scheduled_hold_at: scheduledHoldAt,
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
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
