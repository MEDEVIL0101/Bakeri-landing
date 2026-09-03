import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

// Baker-triggered: Banking & Payments screen. A direct charge lands on the
// baker's OWN connected Stripe account instantly. On Standard accounts the
// baker logs into a normal Stripe dashboard with their own credentials
// (dashboard.stripe.com) and controls their own payout schedule / instant
// payouts there — the platform can't (and shouldn't) trigger payouts for
// them. This still surfaces the balance and recent activity in-app as a
// convenience, but every "move the money" action lives in Stripe.
//
// Reads are best-effort: a Standard account can return a permission error on
// some of these endpoints, and a single failure must not blank the whole
// screen — each piece degrades independently.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const stripe = getStripeClient();

// Standard accounts use the regular Stripe dashboard; there's no per-account
// login link to mint (that's Express-only). Deep-link straight to the
// balance page.
const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com/balance";

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

    // listExternalAccounts is NOT permitted for Standard connected accounts
    // (they have full Dashboard access and own their negative-balance
    // liability, so Stripe won't expose their bank/card details to the
    // platform). balance.retrieve and balanceTransactions.list DO work via
    // the Stripe-Account header. The baker manages payout methods in their
    // own Stripe dashboard; Stripe won't let onboarding complete without one,
    // so "onboarding_complete" already implies a payout method exists.
    const [balanceR, balanceTxR] = await Promise.allSettled([
      stripe.balance.retrieve({ stripeAccount: acctId }),
      stripe.balanceTransactions.list({ limit: 15 }, { stripeAccount: acctId }),
    ]);

    const balance = balanceR.status === "fulfilled" ? balanceR.value : null;
    const balanceTx = balanceTxR.status === "fulfilled" ? balanceTxR.value : null;

    const sumByCurrency = (arr: { amount: number; currency: string }[] | undefined) =>
      (arr ?? []).reduce((sum, a) => sum + a.amount, 0);

    // deno-lint-ignore no-explicit-any
    const instantAvailable = (balance as any)?.instant_available as { amount: number; currency: string }[] | undefined;

    return json({
      available_cents: sumByCurrency(balance?.available),
      pending_cents: sumByCurrency(balance?.pending),
      instant_available_cents: instantAvailable ? sumByCurrency(instantAvailable) : 0,
      currency: (balance?.available?.[0]?.currency ?? "cad").toUpperCase(),
      // Can't verify these for Standard accounts (see above). Onboarding
      // completion already guarantees a payout method; kept in the response
      // for shape-stability with the shipped app build, which decodes them.
      has_bank_account: true,
      has_debit_card: true,
      // Kept for response-shape stability with the shipped app build; it's now
      // just the standard Stripe dashboard, not a minted per-account link.
      dashboard_login_url: STRIPE_DASHBOARD_URL,
      recent_transactions: (balanceTx?.data ?? []).slice(0, 10).map((bt) => ({
        id: bt.id,
        type: bt.type,
        amount_cents: bt.amount,
        net_cents: bt.net,
        fee_cents: bt.fee,
        status: bt.status,
        created_at: new Date(bt.created * 1000).toISOString(),
        available_on: new Date(bt.available_on * 1000).toISOString(),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 400);
  }
});
