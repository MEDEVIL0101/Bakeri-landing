import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

// Baker-triggered: "Request Payout" on the Banking & Payments screen. Pays
// out the connected account's current standard `available` balance (not
// instant — an instant payout carries a Stripe fee that needs its own
// consent UI, which Stripe's own hosted Express dashboard already handles;
// this button is for the no-fee standard payout, the same primitive the
// account's own automatic daily schedule already uses, just triggered on
// demand instead of waiting).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const stripe = getStripeClient();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
      .eq("id", user.id)
      .single();
    if (profileErr || !profile?.stripe_connect_account_id || !profile.stripe_connect_onboarding_complete) {
      throw new Error("Stripe account not connected");
    }
    const acctId = profile.stripe_connect_account_id;

    const externalAccounts = await stripe.accounts.listExternalAccounts(acctId, { object: "bank_account", limit: 1 });
    if (externalAccounts.data.length === 0) {
      throw new Error("no_payout_destination");
    }

    const balance = await stripe.balance.retrieve({ stripeAccount: acctId });
    const available = balance.available.find((b) => b.amount > 0);
    if (!available || available.amount <= 0) {
      throw new Error("no_available_balance");
    }

    const payout = await stripe.payouts.create(
      { amount: available.amount, currency: available.currency },
      { stripeAccount: acctId }
    );

    return json({
      ok: true,
      payout_id: payout.id,
      amount_cents: payout.amount,
      currency: payout.currency,
      arrival_date: new Date(payout.arrival_date * 1000).toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
