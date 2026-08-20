-- Same root cause as mock_confirm_quote_payment: trg_orders_guard_sensitive_columns
-- blocks any client from writing payment_status directly, but two more code paths
-- do exactly that as a plain client-side update:
--   1. PaymentService.confirmQuotePayment — the REAL Stripe confirmation step,
--      called right after a successful card charge. This means a customer could
--      be charged and the order would still get silently stuck un-confirmed.
--   2. The "force-complete" fallback (both buyer and baker sides) when both
--      parties have confirmed pickup but the status never progressed.

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
        payment_status      = 'authorized',
        payment_intent_id   = p_payment_intent_id,
        updated_at          = now()
    WHERE id = p_order_id;

    RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_real_quote_payment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_real_quote_payment(UUID, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.force_complete_marketplace_order(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer UUID;
    v_owner UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT buyer_profile_id, user_id INTO v_buyer, v_owner FROM orders WHERE id = p_order_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF auth.uid() != v_buyer AND auth.uid() != v_owner THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    UPDATE orders SET
        marketplace_status = 'completed',
        payment_status      = 'captured',
        updated_at          = now()
    WHERE id = p_order_id;

    RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.force_complete_marketplace_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_complete_marketplace_order(UUID) TO authenticated;
