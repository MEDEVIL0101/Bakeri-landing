// stripe-connect-webhook
// Handles Stripe Connect account capability events (V2 thin events).
//
// This platform's Connect accounts only emit V2 thin events for capability
// changes (v2.core.account[configuration.*].capability_status_updated) —
// confirmed empirically via Stripe's own Events log, which showed zero
// classic V1 account.updated events for a real onboarding completion.
// Thin events carry no inline object data (just related_object.id), so on
// every capability-status event we re-fetch the account's real V2 state and
// only flip onboarding_complete once both required capabilities are active.
//
// Register in Stripe Dashboard → Event destinations → Add destination:
//   URL: https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/stripe-connect-webhook
//   Payload: thin
//   Events: v2.core.account[configuration.merchant].capability_status_updated
//           v2.core.account[configuration.recipient].capability_status_updated

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
  const secret    = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "";

  let event: ThinEvent;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret) as unknown as ThinEvent;
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const isCapabilityEvent =
    event.type === "v2.core.account[configuration.merchant].capability_status_updated" ||
    event.type === "v2.core.account[configuration.recipient].capability_status_updated";

  if (isCapabilityEvent && event.related_object?.id) {
    const accountId = event.related_object.id;

    if (await isFullyOnboarded(accountId)) {
      await supabase
        .from("profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_onboarding_complete: true,
        })
        .eq("stripe_connect_account_id", accountId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
