-- ============================================================
-- Marketplace Phase 3: Buyer can read their own orders
-- ============================================================

-- Buyers need to read the orders they placed (buyer_profile_id = auth.uid()).
-- The existing policy on orders is per baker (user_id = auth.uid()).
-- We add a second SELECT policy for the buyer side.

CREATE POLICY "marketplace_buyer_read_own_orders"
ON orders FOR SELECT
USING (
    order_source = 'marketplace'
    AND buyer_profile_id = auth.uid()
);

-- Buyers also need to read the order_items for their orders.
-- This join is done server-side via the edge function (service role),
-- but the iOS client queries directly via PostgREST with the buyer's JWT.

CREATE POLICY "marketplace_buyer_read_own_order_items"
ON order_items FOR SELECT
USING (
    order_id IN (
        SELECT id FROM orders
        WHERE order_source = 'marketplace'
          AND buyer_profile_id = auth.uid()
    )
);
