import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";

// Baker-triggered: Banking & Payments screen. A direct charge lands on the
// baker's OWN connected Stripe account instantly — but Express accounts have
// a completely separate dashboard from a normal Stripe login, reachable only
// via a one-time login link or a specific Express URL. A baker who didn't
// know that saw nothing, anywhere, and reasonably concluded the money had
// vanished (confirmed live 2026-08-08 — real funds were sitting there the
// whole time, just on a screen nobody could find). This surfaces the same
// numbers in-app directly, plus always generates a fresh login link (a baker
// bookmarking or getting sent a stale one after any account reset was part
// of the original confusion).

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

    const [balance, balanceTx, bankAccounts, debitCards, loginLink] = await Promise.all([
      stripe.balance.retrieve({ stripeAccount: acctId }),
      stripe.balanceTransactions.list({ limit: 15 }, { stripeAccount: acctId }),
      // A standard payout (trigger-baker-payout) needs a bank_account; an
      // instant payout needs a card — different requirements, reported
      // separately so the app can prompt for the right one.
      stripe.accounts.listExternalAccounts(acctId, { object: "bank_account", limit: 1 }),
      stripe.accounts.listExternalAccounts(acctId, { object: "card", limit: 1 }),
      stripe.accounts.createLoginLink(acctId),
    ]);

    const sumByCurrency = (arr: { amount: number; currency: string }[]) =>
      arr.reduce((sum, a) => sum + a.amount, 0);

    // deno-lint-ignore no-explicit-any
    const instantAvailable = (balance as any).instant_available as { amount: number; currency: string }[] | undefined;

    return json({
      available_cents: sumByCurrency(balance.available),
      pending_cents: sumByCurrency(balance.pending),
      instant_available_cents: instantAvailable ? sumByCurrency(instantAvailable) : 0,
      currency: (balance.available[0]?.currency ?? "cad").toUpperCase(),
      has_bank_account: bankAccounts.data.length > 0,
      has_debit_card: debitCards.data.length > 0,
      dashboard_login_url: loginLink.url,
      recent_transactions: balanceTx.data.slice(0, 10).map((bt) => ({
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
