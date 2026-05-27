-- Allow buyers to cancel their own active marketplace orders.
-- USING: row must be theirs and still in an active state.
-- WITH CHECK: the resulting row must have marketplace_status = 'cancelled'.

CREATE POLICY "marketplace_buyer_cancel_own_order"
ON orders FOR UPDATE
USING (
    order_source = 'marketplace'
    AND buyer_profile_id = auth.uid()
    AND marketplace_status IN ('pending', 'pending_quote', 'quote_provided')
)
WITH CHECK (
    order_source = 'marketplace'
    AND buyer_profile_id = auth.uid()
    AND marketplace_status = 'cancelled'
);
