-- Temporary debug RPC to inspect order_items for orders with an invoice_code.
-- Dropped in a follow-up migration once used.

DROP FUNCTION IF EXISTS public.debug_list_invoice_order_items();

CREATE OR REPLACE FUNCTION public.debug_list_invoice_order_items()
RETURNS TABLE(
    order_id UUID,
    order_name TEXT,
    invoice_code TEXT,
    baker_name TEXT,
    item_id UUID,
    custom_name TEXT,
    quantity INT,
    price_per_unit NUMERIC,
    deleted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT o.id, o.order_name, o.invoice_code,
           COALESCE(p.business_name, p.user_name, 'Baker'),
           oi.id, oi.custom_name, oi.quantity, oi.price_per_unit, oi.deleted_at
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN profiles p ON p.id = o.user_id
    WHERE o.invoice_code IS NOT NULL
    ORDER BY o.created_at DESC, oi.id
    LIMIT 40;
$$;

GRANT EXECUTE ON FUNCTION public.debug_list_invoice_order_items() TO anon, authenticated;
