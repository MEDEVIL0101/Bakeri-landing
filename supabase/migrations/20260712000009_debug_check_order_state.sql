CREATE OR REPLACE FUNCTION public.debug_check_order_state(p_id UUID)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT row_to_json(o) FROM (
        SELECT id, invoice_code, is_paid, paid_at, payment_status, marketplace_status,
               buyer_profile_id, order_source, quoted_price, updated_at
        FROM orders WHERE id = p_id
    ) o;
$$;

GRANT EXECUTE ON FUNCTION public.debug_check_order_state(UUID) TO anon, authenticated;
