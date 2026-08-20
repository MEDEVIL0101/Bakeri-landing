-- Lets a baker undo an accidental "Mark Order as Completed" tap and pull the
-- order back into the active flow. Mirrors authorize_pickup's own
-- auth/ownership shape exactly, just running its field changes in reverse.
--
-- Deliberately does NOT touch payment_status/is_paid/paid_at: per
-- authorize_pickup's own doc comment (PaymentService+Connect.swift), no
-- money moves at completion — it already moved earlier at checkout or
-- order-acceptance time — so there's nothing payment-side to undo here,
-- and reverting those fields would incorrectly suggest a captured charge
-- needs to be captured again.
--
-- Target status is inferred from is_delivery since marketplace_status
-- itself gets overwritten by completion and nothing records what it was
-- before — matches the only two statuses the app's own "Mark Order as
-- Completed" button is ever shown from (ready_for_pickup / out_for_delivery,
-- see actionButtons in MarketplaceOrderSheet.swift).

CREATE OR REPLACE FUNCTION public.undo_order_completion(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status      TEXT;
    v_baker_id    UUID;
    v_is_delivery BOOLEAN;
    v_target      TEXT;
BEGIN
    SELECT marketplace_status, user_id, is_delivery
    INTO v_status, v_baker_id, v_is_delivery
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_not_found';
    END IF;

    IF v_baker_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;

    IF v_status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'order_not_completed';
    END IF;

    v_target := CASE WHEN v_is_delivery THEN 'out_for_delivery' ELSE 'ready_for_pickup' END;

    UPDATE public.orders
    SET
        marketplace_status     = v_target,
        baker_pickup_confirmed = FALSE,
        buyer_pickup_confirmed = FALSE,
        completed_at           = NULL,
        updated_at              = now()
    WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_order_completion(UUID) TO authenticated;
