// Shared Stripe SDK client — matches the pattern already used in
// create-connect-account-link, stripe-connect-webhook, and
// release-baker-payouts. Charge-creation functions previously hand-rolled
// raw fetch() calls to Stripe's REST API instead of the SDK; moved onto the
// SDK so `{stripeAccount: acctId}` (Connect direct-charge request option) is
// available without manually setting a Stripe-Account header on every call.

import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";

export function getStripeClient(): Stripe {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
}
