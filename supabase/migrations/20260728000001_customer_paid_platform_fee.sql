-- Fee model flip: Bakeri's 5% platform fee moves from "deducted off the
-- baker's payout" to "added on top of the customer's charge" — the baker
-- now receives their full listed price minus only Stripe's real processing
-- fee, and the platform's cut is exactly the amount the customer was
-- additionally charged. Requested 2026-07-27: "the transaction fee ... that
-- should go to us (5%) should be added to the customers order, instead of
-- coming off the bakers price. The Stripe fee is passed to the baker as is
-- reasonable. This is what other competitors are doing."
--
-- Consequence: since the fee is now baked into the charge amount rather than
-- carved out of it at payout time, release-baker-payouts can no longer
-- recompute platform_fee_cents as 5% of amount_received (that would double
-- dip against an already-inflated amount) — it has to read the *exact* fee
-- cents that were added at charge time. Every charge-creating function now
-- writes platform_fee_cents onto the order itself; release-baker-payouts
-- only reads it.
--
-- Deposits previously used a Stripe destination charge (application_fee_amount
-- + transfer_data), which instantly transfers to the baker and — critically —
-- has Stripe's own processing fee deducted from the *platform's* cut, not the
-- baker's. To make the baker bear the real Stripe fee on deposits too (like
-- every other order), deposits are unified onto the same "charge Bakeri's own
-- balance, sweep a manual transfer later" model as regular orders. That means
-- deposits move from an instant transfer to release-baker-payouts's normal
-- 24h-dispute-window sweep — confirmed acceptable 2026-07-27 in exchange for
-- the transferred amount reflecting the *real* Stripe fee instead of an
-- estimate. Since a custom order's deposit and balance are two separate
-- Stripe charges on one order row, and orders.payment_intent_id gets
-- overwritten by the balance charge once it's collected, the deposit needs
-- its own leg of tracking columns (mirroring platform_fee_cents/
-- stripe_fee_cents/baker_payout_cents/baker_transfer_id, which now describe
-- only the main/balance leg).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deposit_payment_intent_id  TEXT,
  ADD COLUMN IF NOT EXISTS deposit_charged_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_transfer_id         TEXT,
  ADD COLUMN IF NOT EXISTS deposit_platform_fee_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_stripe_fee_cents    INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_baker_payout_cents  INTEGER;

COMMENT ON COLUMN public.orders.deposit_payment_intent_id IS 'The deposit leg''s own Stripe PaymentIntent id, snapshotted before charge-balance-payment overwrites payment_intent_id with the balance leg''s intent.';
COMMENT ON COLUMN public.orders.deposit_charged_at         IS 'When the deposit successfully charged into Bakeri''s platform balance — release-baker-payouts sweeps it 24h after this, same dispute window as any other order.';
COMMENT ON COLUMN public.orders.deposit_transfer_id        IS 'Stripe transfer id once the deposit leg has been swept to the baker (mirrors baker_transfer_id for the main/balance leg).';
COMMENT ON COLUMN public.orders.deposit_platform_fee_cents IS 'Bakeri''s platform fee on the deposit leg, in cents — set when the deposit is charged, read verbatim by release-baker-payouts (never recomputed from amount_received, which now already includes it).';
COMMENT ON COLUMN public.orders.deposit_stripe_fee_cents   IS 'Stripe''s actual processing fee on the deposit leg''s charge, in cents, deducted from the baker''s deposit payout.';
COMMENT ON COLUMN public.orders.deposit_baker_payout_cents IS 'Amount actually transferred to the baker for the deposit leg, in cents.';

COMMENT ON COLUMN public.orders.platform_fee_cents IS 'Bakeri''s platform fee on this order''s main/balance charge, in cents — set by the charging/finalizing function at charge time (added to what the customer paid), read verbatim by release-baker-payouts. No longer computed at payout time as a percentage of amount_received, since amount_received now already includes this fee.';
COMMENT ON COLUMN public.orders.stripe_fee_cents   IS 'Stripe''s actual processing fee on this order''s main/balance charge, in cents, deducted from the baker''s payout.';
COMMENT ON COLUMN public.orders.baker_payout_cents IS 'Amount actually transferred to the baker for this order''s main/balance leg, in cents (amount_received - platform_fee_cents - stripe_fee_cents).';

-- confirm_real_quote_payment (native, authenticated pay-quote-order flow) —
-- buyer-callable RPC, so fee/amount figures are derived from the order's own
-- quoted_price/deposit_amount_cents rather than trusted from the client.
-- Mirrors pay-quote-order's isPartialDeposit split: a quote with a deposit
-- smaller than the full price only charges the deposit now (the balance
-- comes later via charge-balance-payment), so this only records the
-- *deposit* leg's fee/tracking columns in that case — platform_fee_cents
-- (the main/balance leg) is left for charge-balance-payment to set.
CREATE OR REPLACE FUNCTION public.confirm_real_quote_payment(p_order_id UUID, p_payment_intent_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer UUID;
    v_quoted_price NUMERIC;
    v_deposit_cents INTEGER;
    v_total_cents INTEGER;
    v_is_partial_deposit BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT buyer_profile_id, quoted_price, deposit_amount_cents
    INTO v_buyer, v_quoted_price, v_deposit_cents
    FROM orders WHERE id = p_order_id;
    IF v_buyer IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_buyer IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    v_total_cents := ROUND(COALESCE(v_quoted_price, 0) * 100);
    v_deposit_cents := COALESCE(v_deposit_cents, 0);
    v_is_partial_deposit := v_deposit_cents > 0 AND v_deposit_cents < v_total_cents;

    IF v_is_partial_deposit THEN
        UPDATE orders SET
            marketplace_status          = 'confirmed',
            status                       = 'Confirmed',
            payment_status               = 'authorized',
            payment_intent_id            = p_payment_intent_id,
            deposit_payment_intent_id    = p_payment_intent_id,
            deposit_charged_at           = now(),
            deposit_platform_fee_cents   = ROUND(v_deposit_cents * 0.05),
            deposit_amount               = v_deposit_cents / 100.0,
            deposit_paid_at              = now(),
            deposit_note                 = 'Non-refundable deposit',
            updated_at                   = now()
        WHERE id = p_order_id;
    ELSE
        UPDATE orders SET
            marketplace_status = 'confirmed',
            status              = 'Confirmed',
            payment_status      = 'captured',
            is_paid             = true,
            paid_at             = now(),
            payment_intent_id   = p_payment_intent_id,
            platform_fee_cents  = ROUND(v_total_cents * 0.05),
            updated_at          = now()
        WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok', true, 'is_partial_deposit', v_is_partial_deposit);
END;
$$;
