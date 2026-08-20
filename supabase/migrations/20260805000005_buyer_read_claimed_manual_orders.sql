-- A buyer who claims + pays a manual order's invoice in-app (claim_invoice)
-- must be able to see that order in their own Orders tab, same as any
-- marketplace order, until it's completed/delivered — order_source staying
-- 'manual' (see 20260805000003_order_source_immutable.sql) shouldn't hide
-- it. The buyer-read RLS policies were scoped to order_source = 'marketplace'
-- only, which silently filtered out claimed manual orders regardless of what
-- the client queries for. buyer_profile_id = auth.uid() alone is already a
-- safe, sufficient scope — that column is only ever set on an order to the
-- buyer who actually claimed/placed it (claim_invoice or a genuine
-- marketplace-order-creation path), never anyone else's.

DROP POLICY IF EXISTS "marketplace_buyer_read_own_orders" ON orders;

CREATE POLICY "marketplace_buyer_read_own_orders"
ON orders FOR SELECT
USING (
    buyer_profile_id = auth.uid()
);

DROP POLICY IF EXISTS "marketplace_buyer_read_own_order_items" ON order_items;

CREATE POLICY "marketplace_buyer_read_own_order_items"
ON order_items FOR SELECT
USING (
    order_id IN (
        SELECT id FROM orders
        WHERE buyer_profile_id = auth.uid()
    )
);
