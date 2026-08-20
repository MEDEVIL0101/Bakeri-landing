-- get_invoice_preview and claim_invoice were summing/listing ALL order_items
-- rows for an order, including ones already soft-deleted (deleted_at set) by
-- AddEditOrderView's recreate-on-every-save flow. That double-counted items
-- for any order that had been edited at least once after creation.

CREATE OR REPLACE FUNCTION public.get_invoice_preview(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_baker_name TEXT;
    v_items JSON;
BEGIN
    SELECT o.id, o.user_id, o.due_date, o.is_paid, o.buyer_profile_id
    INTO v_order
    FROM orders o
    WHERE o.invoice_code = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_order.id IS NULL THEN
        RETURN json_build_object('error', 'not_found');
    END IF;
    IF v_order.is_paid THEN
        RETURN json_build_object('error', 'already_paid');
    END IF;
    IF v_order.buyer_profile_id IS NOT NULL THEN
        RETURN json_build_object('error', 'already_claimed');
    END IF;

    SELECT COALESCE(business_name, user_name, 'Baker') INTO v_baker_name
    FROM profiles WHERE id = v_order.user_id;

    SELECT json_agg(json_build_object('name', custom_name, 'quantity', quantity))
    INTO v_items
    FROM order_items WHERE order_id = v_order.id AND deleted_at IS NULL;

    RETURN json_build_object(
        'order_id',    v_order.id,
        'baker_name',  v_baker_name,
        'due_date',    v_order.due_date,
        'items',       COALESCE(v_items, '[]'::json),
        'total',       (SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM order_items WHERE order_id = v_order.id AND deleted_at IS NULL)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_is_paid BOOLEAN;
    v_existing_buyer UUID;
    v_total NUMERIC;
    v_handle TEXT;
    v_name TEXT;
    v_display_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, is_paid, buyer_profile_id INTO v_order_id, v_is_paid, v_existing_buyer
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

    UPDATE orders
    SET buyer_profile_id    = auth.uid(),
        buyer_display_name  = v_display_name,
        order_source        = 'marketplace',
        marketplace_status  = 'quote_provided',
        quoted_price        = v_total,
        updated_at          = now()
    WHERE id = v_order_id;

    RETURN v_order_id;
END;
$$;
