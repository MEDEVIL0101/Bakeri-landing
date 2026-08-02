import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { PLATFORM_FEE_RATE } from "../_shared/fees.ts";
import { friendlyStripeError } from "../_shared/stripeErrors.ts";

const stripe = getStripeClient();

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

interface BakerConnectRow {
  id: string;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;
}

// A storefront can't take a real checkout until its baker has finished
// Stripe Connect — otherwise there's no destination to eventually pay them
// out to. Checked against every baker present in the cart, not just the
// primary one, since a connect account can lapse between page load and
// submit.
async function fetchBakerConnectRows(bakerIds: string[]): Promise<BakerConnectRow[] | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, stripe_connect_account_id, stripe_connect_onboarding_complete")
    .in("id", bakerIds);
  if (error || !data || data.length !== bakerIds.length) return null;
  return data;
}

function allBakersStripeReady(rows: BakerConnectRow[]): boolean {
  return rows.every((p) => p.stripe_connect_onboarding_complete && p.stripe_connect_account_id);
}

// Both the app (CheckoutView.swift, real signed-in buyer) and the guest
// storefront (baker/checkout.html, digital-checkout.html — always just the
// anon key, no session) call this same endpoint. The service charge is only
// added to the customer's total for the app; a guest checkout pays exactly
// the item price and Bakeri's cut comes out of the baker's side instead —
// see _shared/fees.ts. Detected by whether the Authorization bearer
// resolves to a real signed-in user, not a client-supplied flag, since the
// fee side this determines shouldn't be something the client can choose.
async function isAuthenticatedBuyer(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await anonClient.auth.getUser();
  return Boolean(user);
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
    const isApp = await isAuthenticatedBuyer(req.headers.get("Authorization"));
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

    // Service charge — computed off the pre-tax item/deposit base (tax is a
    // pass-through, not something the platform takes a cut of).
    //
    // Guest/website checkout: NOT added to the customer's charge — the
    // customer pays exactly the item/deposit price, and Bakeri's one 5% cut
    // comes entirely out of the baker's side (applicationFeeCents below).
    //
    // App: added to what the customer pays AND taken from the baker's side
    // — both parties pay their own 5% (2026-08-02 decision), so Bakeri
    // collects platformFeeCents twice: once already embedded in chargeCents
    // via the customer's added fee, once more carved out of the baker's own
    // base price. See _shared/fees.ts.
    const platformFeeCents = Math.round((depositAmountCents ?? itemsTotalCents) * PLATFORM_FEE_RATE);
    const chargeCents = (depositAmountCents ?? fullTotalCents) + (isApp ? platformFeeCents : 0);
    const applicationFeeCents = isApp ? platformFeeCents * 2 : platformFeeCents;

    // Regular (non-deposit) orders now hold the funds — authorize at checkout,
    // capture only once the baker actually accepts the order (capture-payment,
    // called from MarketplaceOrderSheet's accept actions). If the baker never
    // accepts (declines, or the guest-order expiry cron times it out), the
    // authorization is simply cancelled — no charge, no non-refundable Stripe
    // fee. Digital goods capture immediately — there's no physical handoff to
    // wait for, so the sale (and the buyer's download) is done the moment
    // payment succeeds. Digital purchases are always solo (never mixed into a
    // cart with physical items — see finalize-guest-digital-order), so
    // checking the first item is sufficient.
    const isDigital = items.every((i) => i.listing_kind === "digital");
    const captureMethod = (paymentFlow === "deposit_and_save" || isDigital) ? "automatic" : "manual";

    const bakerIDs = [...new Set(items.map((i) => i.baker_id))];

    const bakerRows = await fetchBakerConnectRows(bakerIDs);
    if (!bakerRows || !allBakersStripeReady(bakerRows)) {
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

    const isSingleBaker = bakerIDs.length === 1;
    const paymentModel: "direct" | "platform_custody" = isSingleBaker ? "direct" : "platform_custody";

    const createParams: Record<string, unknown> = {
      amount: chargeCents,
      currency,
      capture_method: captureMethod,
      automatic_payment_methods: { enabled: true },
      metadata,
    };

    if (paymentFlow === "deposit_and_save") {
      createParams.setup_future_usage = "off_session";
    }

    let intent;
    let connectedAccountId: string | null = null;

    if (isSingleBaker) {
      // Direct charge: created on the baker's own connected account, so
      // funds settle instantly and Stripe's fee is deducted from the
      // baker's balance automatically. application_fee_amount is
      // applicationFeeCents (see above) — one 5% cut for a guest order,
      // taken entirely from the baker; two 5% cuts for an app order (the
      // customer's added fee plus a matching cut from the baker's own base).
      connectedAccountId = bakerRows[0].stripe_connect_account_id!;
      createParams.application_fee_amount = applicationFeeCents;
      intent = await stripe.paymentIntents.create(
        // deno-lint-ignore no-explicit-any
        createParams as any,
        { stripeAccount: connectedAccountId }
      );
    } else {
      // Multi-baker cart (dormant today — unreachable until the cross-baker
      // marketplace reopens): unchanged platform-custody model. Charge lands
      // in Bakeri's own balance; release-baker-payouts sweeps each baker's
      // cut out later.
      // deno-lint-ignore no-explicit-any
      intent = await stripe.paymentIntents.create(createParams as any);
    }

    return new Response(
      JSON.stringify({
        payment_intent_id: intent.id,
        client_secret: intent.client_secret,
        amount_cents: chargeCents,
        capture_method: captureMethod,
        payment_flow: paymentFlow,
        deposit_amount_cents: depositAmountCents,
        platform_fee_cents: platformFeeCents,
        payment_model: paymentModel,
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
    return new Response(JSON.stringify({ error: friendlyStripeError(err) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
