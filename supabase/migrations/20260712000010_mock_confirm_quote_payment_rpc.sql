-- trg_orders_guard_sensitive_columns (20260626000002) blocks any client from
-- modifying payment_status directly — by design, since real payments are
-- supposed to go through edge functions/RPCs running as service_role. But
-- mockConfirmPayment() in OrderStatusView.swift updates payment_status
-- directly as the buyer's own client, so every test-mode "Pay & Confirm
-- Order" tap has been silently rejected by the trigger since that migration
-- landed — the client swallows the error with try?, so nothing appeared
-- wrong except the order never leaving "Quote Received".
--
-- Route the mock payment through a SECURITY DEFINER RPC instead, which runs
-- as the function owner and satisfies the trigger's service-role bypass,
-- while re-checking the same ownership/status conditions the old client-side
-- RLS policy relied on.

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
            payment_status     = 'authorized',
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

REVOKE ALL ON FUNCTION public.mock_confirm_quote_payment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mock_confirm_quote_payment(UUID) TO authenticated;
