// stripe-connect-webhook
// Handles Stripe Connect account events.
// account.updated: marks onboarding complete when charges_enabled = true.
//
// Register in Stripe Dashboard → Webhooks → Add endpoint:
//   URL: https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/stripe-connect-webhook
//   Events: account.updated

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req) => {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  const secret    = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;

    if (account.charges_enabled) {
      await supabase
        .from("profiles")
        .update({
          stripe_connect_account_id: account.id,
          stripe_connect_onboarding_complete: true,
        })
        .eq("stripe_connect_account_id", account.id);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
