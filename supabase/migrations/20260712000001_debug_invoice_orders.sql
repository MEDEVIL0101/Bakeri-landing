-- Temporary debug RPC to inspect orders with an invoice_code set.
-- Dropped in a follow-up migration once used.

CREATE OR REPLACE FUNCTION public.debug_list_invoice_orders()
RETURNS TABLE(
    id UUID,
    invoice_code TEXT,
    is_paid BOOLEAN,
    buyer_profile_id UUID,
    order_source TEXT,
    marketplace_status TEXT,
    order_name TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT id, invoice_code, is_paid, buyer_profile_id, order_source, marketplace_status, order_name, created_at, updated_at
    FROM orders
    WHERE invoice_code IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.debug_list_invoice_orders() TO anon, authenticated;
