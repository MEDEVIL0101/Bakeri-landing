import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

// Mints a Stripe Terminal connection token scoped to the baker's own
// connected account (Stripe-Account, not the platform account) — Tap to Pay
// on iPhone needs this to boot the on-device reader. Same direct-charge
// account model as pay-quote-order: the reader and every PaymentIntent it
// collects must live on the connected account, not the platform.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = getStripeClient();

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
    const { data: baker } = await supabase
      .from("profiles")
      .select(
        "stripe_connect_account_id, stripe_connect_onboarding_complete, stripe_terminal_location_id, pickup_address, pickup_city, pickup_province, country, business_name"
      )
      .eq("id", user.id)
      .single();

    if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
      throw new Error("Finish setting up Stripe before using Tap to Pay.");
    }
    const connectedAccountId = baker.stripe_connect_account_id;

    const connectionToken = await stripe.terminal.connectionTokens.create(
      {},
      { stripeAccount: connectedAccountId }
    );

    // A Terminal reader connection must be registered to a Location — create
    // one lazily the first time this baker uses Tap to Pay, then cache it.
    // Locations can't be created client-side (StripeTerminal SDK docs), only
    // via this REST call, and there's no in-app UI to manage them since one
    // per baker is all Tap to Pay needs here.
    let locationId = baker.stripe_terminal_location_id as string | null;
    if (!locationId) {
      const location = await stripe.terminal.locations.create(
        {
          display_name: baker.business_name || "Bakeri",
          address: {
            line1: baker.pickup_address || "",
            city: baker.pickup_city || "",
            state: baker.pickup_province || "",
            country: baker.country || "CA",
          },
        },
        { stripeAccount: connectedAccountId }
      );
      locationId = location.id;
      await supabase
        .from("profiles")
        .update({ stripe_terminal_location_id: locationId })
        .eq("id", user.id);
    }

    return new Response(
      JSON.stringify({ secret: connectionToken.secret, location_id: locationId }),
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
