-- confirm_real_quote_payment previously always treated a confirmed quote
-- payment as the FULL amount (payment_status = 'captured', is_paid = true).
-- Now that pay-quote-order can charge just the deposit portion when the
-- baker's quote included one, this needs the same full-vs-deposit branch
-- that mock_confirm_quote_payment already has (20260712000010) — otherwise
-- a deposit-only Stripe charge would get recorded as if the whole order
-- were paid.

CREATE OR REPLACE FUNCTION public.confirm_real_quote_payment(p_order_id UUID, p_payment_intent_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_now TIMESTAMPTZ := now();
    v_deposit NUMERIC;
    v_is_full_payment BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, buyer_profile_id, quoted_price, deposit_amount_cents
    INTO v_order
    FROM orders
    WHERE id = p_order_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_order.buyer_profile_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    v_deposit := COALESCE(v_order.deposit_amount_cents, 0) / 100.0;
    v_is_full_payment := v_deposit <= 0 OR v_deposit >= COALESCE(v_order.quoted_price, 0);

    IF v_is_full_payment THEN
        UPDATE orders SET
            marketplace_status = 'confirmed',
            status              = 'Confirmed',
            payment_status      = 'captured',
            is_paid             = true,
            paid_at             = v_now,
            payment_intent_id   = p_payment_intent_id,
            updated_at          = v_now
        WHERE id = p_order_id;
    ELSE
        UPDATE orders SET
            marketplace_status = 'confirmed',
            status              = 'Confirmed',
            payment_status      = 'authorized',
            deposit_amount      = v_deposit,
            deposit_paid_at     = v_now,
            deposit_note        = 'Non-refundable deposit',
            payment_intent_id   = p_payment_intent_id,
            updated_at          = v_now
        WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok', true, 'is_full_payment', v_is_full_payment);
END;
$$;
