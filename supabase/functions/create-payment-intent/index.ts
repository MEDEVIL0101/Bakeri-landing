import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEPOSIT_FRACTION = 0.5; // 50% deposit for custom orders

interface CartItemPayload {
  listing_id: string;
  baker_id: string;
  name: string;
  quantity: number;
  price_from: number;
  listing_kind: "ready_now" | "preorder" | "custom";
  pickup_date?: string | null; // ISO8601 — needed to detect >7d preorders
}

interface RequestBody {
  items: CartItemPayload[];
  currency?: string;
}

type PaymentFlow = "auth_hold" | "setup_intent" | "deposit_and_save";

function detectPaymentFlow(items: CartItemPayload[]): PaymentFlow {
  if (items.some((i) => i.listing_kind === "custom")) {
    return "deposit_and_save";
  }
  const now = Date.now();
  const hasFarPreorder = items.some((i) => {
    if (i.listing_kind !== "preorder" || !i.pickup_date) return false;
    const pickup = new Date(i.pickup_date).getTime();
    return pickup - now > SEVEN_DAYS_MS;
  });
  if (hasFarPreorder) return "setup_intent";
  return "auth_hold";
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

    const paymentFlow = detectPaymentFlow(items);

    // setup_intent flow has no charge at checkout — client should call create-setup-intent instead
    if (paymentFlow === "setup_intent") {
      return new Response(
        JSON.stringify({ error: "Use create-setup-intent for pre-sale orders beyond 7 days", payment_flow: "setup_intent" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const fullTotalCents = Math.round(
      items.reduce((sum, item) => sum + item.price_from * item.quantity, 0) * 100
    );

    // deposit_and_save: charge 50% deposit now, save card for the balance
    const depositAmountCents = paymentFlow === "deposit_and_save"
      ? Math.round(fullTotalCents * DEPOSIT_FRACTION)
      : null;

    const chargeCents = depositAmountCents ?? fullTotalCents;

    // auth_hold uses manual capture; deposit_and_save charges immediately (setup_future_usage saves card)
    const captureMethod = paymentFlow === "auth_hold" ? "manual" : "automatic";

    const bakerIDs = [...new Set(items.map((i) => i.baker_id))];
    const metadata: Record<string, string> = {
      baker_ids: bakerIDs.join(","),
      item_count: String(items.length),
      payment_flow: paymentFlow,
    };

    const intentParams: Record<string, string> = {
      amount: String(chargeCents),
      currency,
      capture_method: captureMethod,
      "automatic_payment_methods[enabled]": "true",
      ...Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])
      ),
    };

    // Save card for future off-session charge (balance hold later)
    if (paymentFlow === "deposit_and_save") {
      intentParams["setup_future_usage"] = "off_session";
    }

    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(intentParams),
    });

    if (!stripeRes.ok) {
      const err = await stripeRes.json();
      throw new Error(err.error?.message ?? "Stripe error");
    }

    const intent = await stripeRes.json();

    return new Response(
      JSON.stringify({
        payment_intent_id: intent.id,
        client_secret: intent.client_secret,
        amount_cents: chargeCents,
        capture_method: captureMethod,
        payment_flow: paymentFlow,
        deposit_amount_cents: depositAmountCents,
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
