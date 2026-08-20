-- order_name is a baker-internal label (e.g. for their own organization) and
-- was never meant to be customer-facing. Replace it in the public invoice
-- preview with the actual item list, matching what a buyer sees on a normal
-- order record.

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
    FROM order_items WHERE order_id = v_order.id;

    RETURN json_build_object(
        'order_id',    v_order.id,
        'baker_name',  v_baker_name,
        'due_date',    v_order.due_date,
        'items',       COALESCE(v_items, '[]'::json),
        'total',       (SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM order_items WHERE order_id = v_order.id)
    );
END;
$$;
