// release-referral-payouts
// Monthly pg_cron sweep (20260908000003_schedule_referral_payouts.sql), 09:00
// UTC on the 1st. Pays each referrer in Bakeri's affiliate program one Stripe
// transfer from the platform balance to their connected account, covering
// every referral earning that has:
//   * cleared its 14-day hold (referral_earnings.payable_after <= now), and
//   * a referred baker who has passed the CAD $100 completed-sales threshold
//     (expressed as >= 500 cents of collected platform fee — see
//     referral_payout_batches),
// netted against any earning that was reversed AFTER already being paid
// (clawback). A referrer whose net is <= 0 is skipped and rolls forward.
//
// The money math is structurally identical to release-baker-payouts' Transfer
// leg: stripe.transfers.create with NO { stripeAccount } option pulls from the
// platform balance (where application_fee_amount from every direct charge
// lands), destination = the referrer's own connected account.
//
// All batch selection + write-back is in SECURITY DEFINER SQL
// (referral_payout_batches / record_referral_payout); this function only moves
// the money and records the outcome.
//
// Auth: internal only — x-webhook-secret, matching release-baker-payouts /
// capture-payment. Never exposed to client JWTs.
//
// Required env: STRIPE_SECRET_KEY, BAKERI_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripeClient } from "../_shared/stripe.ts";
import { currencyForCountry } from "../_shared/currency.ts";

const stripe = getStripeClient();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET") ?? "";

interface Batch {
  referrer_user_id: string;
  stripe_account_id: string | null;
  country: string | null;
  gross_positive_cents: number;
  clawback_cents: number;
  net_cents: number;
  pay_earning_ids: string[];
  clawback_earning_ids: string[];
}

serve(async (req) => {
  const provided = req.headers.get("x-webhook-secret");
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Period bounds: [start of this month 00:00 UTC, now]. Also the idempotency
  // anchor — a re-run in the same calendar month reuses the same key and
  // Stripe returns the original transfer instead of double-paying.
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const results = {
    period: periodKey,
    batches: 0,
    paid: 0,
    paid_cents: 0,
    skipped_no_account: 0,
    failed: 0,
    errors: [] as string[],
  };

  const { data: batchData, error: batchErr } = await supabase.rpc("referral_payout_batches");
  if (batchErr) {
    return new Response(
      JSON.stringify({ error: "Failed to load payout batches", detail: batchErr.message }),
      { status: 500 },
    );
  }

  const batches: Batch[] = Array.isArray(batchData) ? batchData : [];
  results.batches = batches.length;

  for (const b of batches) {
    if (b.net_cents <= 0) continue;

    if (!b.stripe_account_id) {
      results.skipped_no_account++;
      continue;
    }

    const currency = currencyForCountry(b.country);

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: b.net_cents,
          currency,
          destination: b.stripe_account_id,
          transfer_group: `referral_payout_${periodKey}`,
          metadata: {
            kind: "referral_payout",
            referrer_user_id: b.referrer_user_id,
            period: periodKey,
            gross_positive_cents: String(b.gross_positive_cents),
            clawback_cents: String(b.clawback_cents),
            earnings_count: String(b.pay_earning_ids.length),
          },
        },
        { idempotencyKey: `referral_payout_${b.referrer_user_id}_${periodKey}` },
      );

      const { error: recErr } = await supabase.rpc("record_referral_payout", {
        p_referrer: b.referrer_user_id,
        p_transfer_id: transfer.id,
        p_amount_cents: b.net_cents,
        p_currency: currency,
        p_status: "paid",
        p_failure_reason: null,
        p_pay_ids: b.pay_earning_ids,
        p_clawback_ids: b.clawback_earning_ids,
        p_period_start: periodStart.toISOString(),
        p_period_end: now.toISOString(),
      });

      if (recErr) {
        // The transfer went out but we failed to mark the earnings. Surface
        // loudly — the idempotency key means a manual re-run is safe and will
        // reconcile without paying twice.
        results.errors.push(
          `referrer ${b.referrer_user_id}: transfer ${transfer.id} sent but record_referral_payout failed: ${recErr.message}`,
        );
        continue;
      }

      results.paid++;
      results.paid_cents += b.net_cents;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.failed++;
      results.errors.push(`referrer ${b.referrer_user_id}: transfer failed: ${message}`);

      try {
        await supabase.rpc("record_referral_payout", {
          p_referrer: b.referrer_user_id,
          p_transfer_id: null,
          p_amount_cents: b.net_cents,
          p_currency: currency,
          p_status: "failed",
          p_failure_reason: message.slice(0, 500),
          p_pay_ids: [],
          p_clawback_ids: [],
          p_period_start: periodStart.toISOString(),
          p_period_end: now.toISOString(),
        });
      } catch {
        // best effort — the failure is already in results.errors
      }
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});
