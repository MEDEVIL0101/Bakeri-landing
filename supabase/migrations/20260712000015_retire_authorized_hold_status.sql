-- "authorized" (an auth-hold, captured later) was part of an old two-phase
-- handshake flow no longer in use. Full payments should just read as paid
-- immediately — use 'captured' instead of 'authorized' for full-amount
-- confirmations. Deposits keep 'authorized' internally since the *deposit*
-- fields (deposit_amount/deposit_paid_at), not payment_status, are what the
-- UI actually reads to describe a partial payment.

CREATE OR REPLACE FUNCTION public.mock_confirm_quote_payment(p_order_id UUID)
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

    SELECT id, buyer_profile_id, marketplace_status, quoted_price, deposit_amount_cents
    INTO v_order
    FROM orders
    WHERE id = p_order_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_order.buyer_profile_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    IF v_order.marketplace_status != 'quote_provided' THEN
        RAISE EXCEPTION 'not_a_pending_quote';
    END IF;

    v_deposit := COALESCE(v_order.deposit_amount_cents, 0) / 100.0;
    v_is_full_payment := v_deposit <= 0 OR v_deposit >= COALESCE(v_order.quoted_price, 0);

    IF v_is_full_payment THEN
        UPDATE orders SET
            marketplace_status = 'confirmed',
            payment_status     = 'captured',
            is_paid            = true,
            paid_at            = v_now,
            updated_at         = v_now
        WHERE id = p_order_id;
    ELSE
        UPDATE orders SET
            marketplace_status = 'confirmed',
            payment_status     = 'authorized',
            deposit_amount     = v_deposit,
            deposit_paid_at    = v_now,
            deposit_note       = 'Non-refundable deposit',
            updated_at         = v_now
        WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok', true, 'is_full_payment', v_is_full_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_real_quote_payment(p_order_id UUID, p_payment_intent_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT buyer_profile_id INTO v_buyer FROM orders WHERE id = p_order_id;
    IF v_buyer IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_buyer IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    UPDATE orders SET
        marketplace_status = 'confirmed',
        status              = 'Confirmed',
        payment_status      = 'captured',
        is_paid             = true,
        paid_at             = now(),
        payment_intent_id   = p_payment_intent_id,
        updated_at          = now()
    WHERE id = p_order_id;

    RETURN json_build_object('ok', true);
END;
$$;
