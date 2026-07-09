import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const PLATFORM_FEE_RATE = 0.05; // 5% platform fee

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEPOSIT_FRACTION = 0.5; // 50% deposit for custom orders

interface CartItemPayload {
  listing_id: string;
  baker_id: string;
  name: string;
  quantity: number;
  price_from: number;
  listing_kind: "ready_now" | "preorder" | "custom";
  pickup_date?: string | null;
}

interface RequestBody {
  items: CartItemPayload[];
  currency?: string;
  tax_amount_cents?: number;
}

type PaymentFlow = "immediate" | "setup_intent" | "deposit_and_save";

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
  return "immediate";
}

async function getBakerConnectAccountId(bakerId: string): Promise<string | null> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const { data } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
    .eq("id", bakerId)
    .single();
  if (data?.stripe_connect_onboarding_complete && data?.stripe_connect_account_id) {
    return data.stripe_connect_account_id as string;
  }
  return null;
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

    const { items, currency = "cad", tax_amount_cents = 0 }: RequestBody = await req.json();

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No items" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const paymentFlow = detectPaymentFlow(items);

    if (paymentFlow === "setup_intent") {
      return new Response(
        JSON.stringify({ error: "Use create-setup-intent for pre-sale orders beyond 7 days", payment_flow: "setup_intent" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const itemsTotalCents = Math.round(
      items.reduce((sum, item) => sum + item.price_from * item.quantity, 0) * 100
    );
    const fullTotalCents = itemsTotalCents + (tax_amount_cents ?? 0);

    // For deposit flow: deposit is 50% of items total only (tax due at final payment)
    const depositAmountCents = paymentFlow === "deposit_and_save"
      ? Math.round(itemsTotalCents * DEPOSIT_FRACTION)
      : null;

    const chargeCents = depositAmountCents ?? fullTotalCents;
    const applicationFeeCents = Math.round(chargeCents * PLATFORM_FEE_RATE);

    // All flows now capture immediately at checkout — QR scan is authorization only
    const captureMethod = "automatic";

    const bakerIDs = [...new Set(items.map((i) => i.baker_id))];
    const primaryBakerId = bakerIDs[0];

    // Only needed for deposit_and_save — that's the only flow that still
    // transfers at checkout time (see below).
    const connectAccountId = primaryBakerId && paymentFlow === "deposit_and_save"
      ? await getBakerConnectAccountId(primaryBakerId)
      : null;

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

    // Only the deposit charge transfers to the baker immediately — it's
    // non-refundable, so there's no dispute-window risk to hold it against.
    // Regular full-payment orders capture into Bakeri's own balance and get
    // released to the baker later by release-baker-payouts, once the 24h
    // dispute window (orders.completed_at + 24h) has passed.
    if (connectAccountId && paymentFlow === "deposit_and_save") {
      intentParams["application_fee_amount"] = String(applicationFeeCents);
      intentParams["transfer_data[destination]"] = connectAccountId;
    }

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
        connect_account_id: paymentFlow === "deposit_and_save" ? connectAccountId : null,
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
