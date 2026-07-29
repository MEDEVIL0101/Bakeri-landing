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
  listing_kind: "ready_now" | "preorder" | "custom" | "digital";
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

function getSupabaseClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

// A storefront can't take a real checkout until its baker has finished
// Stripe Connect — otherwise there's no destination to eventually pay them
// out to. Checked against every baker present in the cart, not just the
// primary one, since a connect account can lapse between page load and
// submit.
async function allBakersStripeReady(bakerIds: string[]): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, stripe_connect_account_id, stripe_connect_onboarding_complete")
    .in("id", bakerIds);
  if (error || !data || data.length !== bakerIds.length) return false;
  return data.every((p) => p.stripe_connect_onboarding_complete && p.stripe_connect_account_id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        // apikey added: this function had only ever been called from the
        // native app (URLSession, not subject to CORS at all) until
        // baker/checkout.html — a browser fetch() with an apikey header
        // fails preflight without it. No change to the function's own
        // logic; it already has no auth check either way.
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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

    // Platform fee is added to what the customer pays rather than deducted
    // from the baker's cut — computed off the pre-tax item/deposit base (tax
    // is a pass-through, not something the platform takes a cut of). The
    // baker still absorbs the real Stripe processing fee, at payout time.
    const platformFeeCents = Math.round((depositAmountCents ?? itemsTotalCents) * PLATFORM_FEE_RATE);
    const chargeCents = (depositAmountCents ?? fullTotalCents) + platformFeeCents;

    // Regular (non-deposit) orders now hold the funds — authorize at checkout,
    // capture only once the baker actually accepts the order (capture-payment,
    // called from MarketplaceOrderSheet's accept actions). If the baker never
    // accepts (declines, or the guest-order expiry cron times it out), the
    // authorization is simply cancelled — no charge, no non-refundable Stripe
    // fee. Deposits capture immediately (non-refundable) but no longer
    // transfer at checkout — see below, they now go through the same
    // "capture into Bakeri's balance, sweep a transfer later" model as every
    // other order, so the baker's cut can reflect the real Stripe fee instead
    // of the platform absorbing it via a destination-charge split. Digital
    // goods also capture immediately — there's no physical handoff to wait
    // for, so the sale (and the buyer's download) is done the moment payment
    // succeeds. Digital purchases are always solo (never mixed into a cart
    // with physical items — see finalize-guest-digital-order), so checking
    // the first item is sufficient.
    const isDigital = items.every((i) => i.listing_kind === "digital");
    const captureMethod = (paymentFlow === "deposit_and_save" || isDigital) ? "automatic" : "manual";

    const bakerIDs = [...new Set(items.map((i) => i.baker_id))];

    if (!(await allBakersStripeReady(bakerIDs))) {
      return new Response(
        JSON.stringify({ error: "This baker hasn't finished setting up payments yet. Check back soon!" }),
        { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const metadata: Record<string, string> = {
      baker_ids: bakerIDs.join(","),
      item_count: String(items.length),
      payment_flow: paymentFlow,
      platform_fee_cents: String(platformFeeCents),
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

    // No application_fee_amount/transfer_data here for any flow — every
    // charge (including deposits, as of 2026-07-28) lands in Bakeri's own
    // balance and is released to the baker later by release-baker-payouts,
    // once its own dispute window has passed.
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
        platform_fee_cents: platformFeeCents,
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
