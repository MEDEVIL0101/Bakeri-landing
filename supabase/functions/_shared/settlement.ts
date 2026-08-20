// Shared by every finalize/verification path for a 'direct'-model order: once
// a direct charge succeeds, read its real Stripe fee from balance_transaction
// and return the order fields that close the payout loop immediately —
// instead of leaving baker_transfer_id/stripe_fee_cents/baker_payout_cents
// for release-baker-payouts to fill in later (which only runs for
// payment_model = 'platform_custody' orders; a 'direct' order has no Transfer
// object at all, since funds never left the baker's own account).

import Stripe from "https://esm.sh/stripe@13.11.0?target=deno";

export interface DirectSettlementFields {
  baker_transfer_id: string;
  baker_transferred_at: string;
  stripe_fee_cents: number;
  baker_payout_cents: number;
}

// depositLeg=true returns the deposit_* column names instead.
export async function readDirectChargeSettlement(
  stripe: Stripe,
  paymentIntentId: string,
  connectedAccountId: string,
  platformFeeCents: number
): Promise<Record<string, unknown> | null> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      stripeAccount: connectedAccountId,
      expand: ["latest_charge.balance_transaction"],
    });
    // deno-lint-ignore no-explicit-any
    const charge = intent.latest_charge as any;
    const stripeFeeCents = charge?.balance_transaction?.fee;
    if (!charge?.id || typeof stripeFeeCents !== "number") return null;

    const amountReceived = intent.amount_received ?? 0;
    return {
      baker_transfer_id: charge.id,
      baker_transferred_at: new Date().toISOString(),
      stripe_fee_cents: stripeFeeCents,
      baker_payout_cents: amountReceived - platformFeeCents - stripeFeeCents,
    };
  } catch (err) {
    console.error(`Could not read settlement for direct charge ${paymentIntentId}:`, err);
    return null;
  }
}

export function toDepositSettlementFields(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    deposit_transfer_id: fields.baker_transfer_id,
    deposit_stripe_fee_cents: fields.stripe_fee_cents,
    deposit_baker_payout_cents: fields.baker_payout_cents,
  };
}
