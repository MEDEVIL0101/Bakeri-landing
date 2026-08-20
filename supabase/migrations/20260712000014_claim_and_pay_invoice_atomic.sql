-- claim_invoice only attached the order to the buyer (marketplace_status =
-- 'quote_provided') without charging anything — the buyer then had to find
-- the order again and tap a separate "Pay & Confirm Order" button. That let
-- an order sit in someone's Orders tab fully unpaid, which doesn't prove
-- they actually own/paid for it, and is an easy step to abandon halfway.
--
-- claim_and_pay_invoice does both atomically (still TEST MODE — mirrors
-- mock_confirm_quote_payment rather than a real Stripe charge): the order
-- only ever appears in the buyer's Orders tab already confirmed and paid
-- (or deposit-paid), never in a claimed-but-unpaid state.

CREATE OR REPLACE FUNCTION public.claim_and_pay_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_is_paid BOOLEAN;
    v_existing_buyer UUID;
    v_total NUMERIC;
    v_deposit_cents INT;
    v_deposit NUMERIC;
    v_is_full_payment BOOLEAN;
    v_handle TEXT;
    v_name TEXT;
    v_display_name TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, is_paid, buyer_profile_id, deposit_amount_cents
    INTO v_order_id, v_is_paid, v_existing_buyer, v_deposit_cents
    FROM orders
    WHERE invoice_code = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_is_paid THEN
        RAISE EXCEPTION 'already_paid';
    END IF;
    IF v_existing_buyer IS NOT NULL THEN
        RAISE EXCEPTION 'already_claimed';
    END IF;

    SELECT COALESCE(SUM(quantity * price_per_unit), 0) INTO v_total
    FROM order_items WHERE order_id = v_order_id AND deleted_at IS NULL;

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'no_amount_due';
    END IF;

    SELECT community_handle, user_name INTO v_handle, v_name
    FROM profiles WHERE id = auth.uid();

    v_display_name := CASE
        WHEN v_handle IS NOT NULL AND TRIM(v_handle) != '' THEN '@' || TRIM(v_handle)
        WHEN v_name IS NOT NULL AND TRIM(v_name) != '' THEN TRIM(v_name)
        ELSE 'Bakeri customer'
    END;

    v_deposit := COALESCE(v_deposit_cents, 0) / 100.0;
    v_is_full_payment := v_deposit <= 0 OR v_deposit >= v_total;

    IF v_is_full_payment THEN
        UPDATE orders
        SET buyer_profile_id    = auth.uid(),
            buyer_display_name  = v_display_name,
            order_source        = 'marketplace',
            marketplace_status  = 'confirmed',
            quoted_price        = v_total,
            payment_status      = 'captured',
            is_paid             = true,
            paid_at             = v_now,
            updated_at          = v_now
        WHERE id = v_order_id;
    ELSE
        UPDATE orders
        SET buyer_profile_id    = auth.uid(),
            buyer_display_name  = v_display_name,
            order_source        = 'marketplace',
            marketplace_status  = 'confirmed',
            quoted_price        = v_total,
            payment_status      = 'authorized',
            deposit_amount      = v_deposit,
            deposit_paid_at     = v_now,
            deposit_note        = 'Non-refundable deposit',
            updated_at          = v_now
        WHERE id = v_order_id;
    END IF;

    RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_and_pay_invoice(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_and_pay_invoice(TEXT) TO authenticated;
