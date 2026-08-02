-- 2026-08-02 fee-model decision: in-app orders charge Bakeri's 5% service
-- charge on both sides (buyer, added on top of the charge — unchanged; AND
-- baker, carved out of their own quoted price — new). pay-quote-order's
-- PaymentIntent now takes application_fee_amount = platformFeeCents * 2 to
-- actually collect both. confirm_real_quote_payment records
-- platform_fee_cents/deposit_platform_fee_cents on the order afterward, and
-- must store that same doubled figure, or every baker-facing payout
-- estimate for an in-app quote payment (this RPC is the only settlement
-- record such orders get — see PR notes) would understate what Bakeri
-- actually took by one fee-worth.
--
-- Byte-for-byte identical to 20260728000001_customer_paid_platform_fee.sql's
-- definition otherwise — only the two `* 0.05` computations change to
-- `* 0.05 * 2`.

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
            deposit_platform_fee_cents   = ROUND(v_deposit_cents * 0.05) * 2,
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
            platform_fee_cents  = ROUND(v_total_cents * 0.05) * 2,
            updated_at          = now()
        WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok', true, 'is_partial_deposit', v_is_partial_deposit);
END;
$$;
