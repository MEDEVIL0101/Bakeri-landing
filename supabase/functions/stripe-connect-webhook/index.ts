// stripe-connect-webhook
// Flips profiles.stripe_connect_onboarding_complete = true once a baker's
// connected account can actually take payments + pay out.
//
// Two shapes are handled, because the fleet is mid-migration Express -> Standard:
//
//   1. Legacy Express accounts: V2 thin capability events
//      (v2.core.account[configuration.*].capability_status_updated). Thin
//      events carry no object data, so we re-fetch the account's V2 state.
//
//   2. Standard accounts: classic "account.updated" snapshot events, which
//      DO carry the full Account object — check charges_enabled &&
//      payouts_enabled && details_submitted directly.
//
// Neither path is load-bearing: check-connect-account-status (called by the
// app on the Banking screen and on the bakeri://connect-return deep link)
// is the reliable primary mechanism and works for both account types. This
// webhook only additionally covers "baker finished on Stripe but never came
// back to the app".
//
// Stripe Dashboard → Event destinations, pointed at
//   https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/stripe-connect-webhook
//   - thin destination:     v2.core.account[configuration.merchant].capability_status_updated
//                           v2.core.account[configuration.recipient].capability_status_updated
//                           (secret -> STRIPE_CONNECT_WEBHOOK_SECRET)
//   - snapshot destination: account.updated
//                           (secret -> STRIPE_CONNECT_WEBHOOK_SECRET_CLASSIC)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_VERSION = "2026-05-27.dahlia";

// Only used for signature verification here (constructEvent works the same
// for thin events — it's a plain HMAC check, independent of payload shape).
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface ThinEvent {
  id: string;
  type: string;
  related_object: { id: string; type: string; url: string } | null;
  // Present on classic snapshot events (account.updated); absent on thin.
  data?: {
    object?: {
      id?: string;
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      details_submitted?: boolean;
    };
  };
}

// constructEvent verifies against whichever destination signed the request;
// thin and classic destinations have separate signing secrets.
function verify(body: string, signature: string): ThinEvent | null {
  const secrets = [
    Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "",
    Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET_CLASSIC") ?? "",
  ].filter(Boolean);
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(body, signature, secret) as unknown as ThinEvent;
    } catch {
      // try the next secret
    }
  }
  return null;
}

async function isFullyOnboarded(accountId: string): Promise<boolean> {
  const fields = ["configuration.merchant", "configuration.recipient"];
  const url = `https://api.stripe.com/v2/core/accounts/${accountId}?` +
    fields.map((f, i) => `include[${i}]=${encodeURIComponent(f)}`).join("&");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Stripe-Version": STRIPE_VERSION,
    },
  });
  if (!res.ok) return false;

  const account = await res.json();
  const chargesActive =
    account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  const payoutsActive =
    account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === "active";

  return chargesActive && payoutsActive;
}

serve(async (req) => {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  const event = verify(body, signature);
  if (!event) {
    return new Response("Invalid signature", { status: 400 });
  }

  const markComplete = (accountId: string) =>
    supabase
      .from("profiles")
      .update({
        stripe_connect_account_id: accountId,
        stripe_connect_onboarding_complete: true,
      })
      .eq("stripe_connect_account_id", accountId);

  // 1. Legacy Express accounts — V2 thin capability events.
  const isCapabilityEvent =
    event.type === "v2.core.account[configuration.merchant].capability_status_updated" ||
    event.type === "v2.core.account[configuration.recipient].capability_status_updated";

  if (isCapabilityEvent && event.related_object?.id) {
    const accountId = event.related_object.id;
    if (await isFullyOnboarded(accountId)) {
      await markComplete(accountId);
    }
  }

  // 2. Standard accounts — classic account.updated snapshot event.
  if (event.type === "account.updated" && event.data?.object?.id) {
    const acct = event.data.object;
    if (acct.charges_enabled && acct.payouts_enabled && acct.details_submitted) {
      await markComplete(acct.id!);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
