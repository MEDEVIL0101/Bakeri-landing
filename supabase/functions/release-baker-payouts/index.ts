// release-baker-payouts
// Scheduled sweep (pg_cron, see 20260713000004_schedule_baker_payouts.sql):
// finds captured orders whose 24h dispute window has passed and transfers
// each baker's cut (95%, 5% platform fee retained) from Bakeri's own Stripe
// balance into their Connect account. This is the delayed half of the
// "separate charge, then transfer" model — create-payment-intent no longer
// attaches transfer_data to regular orders, so the full captured amount
// sits in the platform balance until this sweep releases it.
//
// Deliberately excludes deposit_and_save orders — the deposit itself
// already transferred at checkout (non-refundable, no dispute window
// needed), and the balance-charge flow for those orders isn't wired into
// this sweep yet; handle it as a separate follow-up once that charge path
// is confirmed.
//
// Auth: internal only — x-webhook-secret header, matching capture-payment/
// cancel-order's convention. Never exposed to client JWTs.
//
// Required env vars:
//   STRIPE_SECRET_KEY, BAKERI_WEBHOOK_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)

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

const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET") ?? "";
const PLATFORM_FEE_RATE = 0.05; // must match create-payment-intent
const DISPUTE_WINDOW_HOURS = 24;

interface EligibleOrder {
  id: string;
  user_id: string; // baker
  payment_intent_id: string;
}

serve(async (req) => {
  const provided = req.headers.get("x-webhook-secret");
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const cutoff = new Date(Date.now() - DISPUTE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: orders, error: fetchErr } = await supabase
    .from("orders")
    .select("id, user_id, payment_intent_id")
    .eq("payment_status", "captured")
    .eq("marketplace_status", "completed")
    .is("baker_transfer_id", null)
    .not("payment_intent_id", "is", null)
    .not("payment_flow", "eq", "deposit_and_save")
    .lte("completed_at", cutoff) as { data: EligibleOrder[] | null; error: unknown };

  if (fetchErr) {
    return new Response(JSON.stringify({ error: "Failed to fetch eligible orders", detail: fetchErr }), { status: 500 });
  }

  const results = { processed: 0, transferred: 0, skipped_no_connect: 0, skipped_mock: 0, errors: [] as string[] };

  for (const order of orders ?? []) {
    results.processed++;

    if (order.payment_intent_id.startsWith("mock_")) {
      results.skipped_mock++;
      continue;
    }

    try {
      const { data: baker } = await supabase
        .from("profiles")
        .select("stripe_connect_account_id, stripe_connect_onboarding_complete")
        .eq("id", order.user_id)
        .single();

      if (!baker?.stripe_connect_onboarding_complete || !baker?.stripe_connect_account_id) {
        results.skipped_no_connect++;
        continue; // baker hasn't connected Stripe yet — picked up by a future run once they do
      }

      const intent = await stripe.paymentIntents.retrieve(order.payment_intent_id);
      const amountReceived = intent.amount_received ?? 0;
      if (amountReceived <= 0) {
        results.errors.push(`order ${order.id}: payment intent has no amount_received (status=${intent.status})`);
        continue;
      }

      const transferAmount = Math.round(amountReceived * (1 - PLATFORM_FEE_RATE));

      const transfer = await stripe.transfers.create(
        {
          amount: transferAmount,
          currency: intent.currency,
          destination: baker.stripe_connect_account_id,
          transfer_group: order.id,
          metadata: { order_id: order.id },
        },
        { idempotencyKey: `payout_${order.id}` }
      );

      const { error: updateErr } = await supabase
        .from("orders")
        .update({ baker_transfer_id: transfer.id, baker_transferred_at: new Date().toISOString() })
        .eq("id", order.id);

      if (updateErr) {
        results.errors.push(`order ${order.id}: transfer ${transfer.id} created but DB update failed: ${updateErr.message}`);
        continue;
      }

      results.transferred++;
    } catch (err) {
      results.errors.push(`order ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});
