-- Quote request flow: custom orders don't require upfront payment.
-- Buyer submits request → baker provides quote → buyer pays quoted price.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS quoted_price NUMERIC(10,2);

-- Buyer can directly insert a pending_quote order (no Stripe PI required)
CREATE POLICY "marketplace_buyer_insert_quote_request"
ON orders FOR INSERT
WITH CHECK (
    order_source = 'marketplace'
    AND marketplace_status = 'pending_quote'
    AND buyer_profile_id = auth.uid()
    AND payment_intent_id IS NULL
);

-- Buyer can insert order_items for their own pending_quote orders
CREATE POLICY "marketplace_buyer_insert_quote_items"
ON order_items FOR INSERT
WITH CHECK (
    order_id IN (
        SELECT id FROM orders
        WHERE buyer_profile_id = auth.uid()
          AND marketplace_status = 'pending_quote'
          AND order_source = 'marketplace'
    )
);

-- Baker can update quoted_price and advance marketplace_status on their own orders
CREATE POLICY "marketplace_baker_update_quote"
ON orders FOR UPDATE
USING (
    order_source = 'marketplace'
    AND user_id = auth.uid()
)
WITH CHECK (
    order_source = 'marketplace'
    AND user_id = auth.uid()
);

-- Buyer can update their quote orders to confirm payment
CREATE POLICY "marketplace_buyer_confirm_payment"
ON orders FOR UPDATE
USING (
    order_source = 'marketplace'
    AND buyer_profile_id = auth.uid()
    AND marketplace_status = 'quote_provided'
)
WITH CHECK (
    order_source = 'marketplace'
    AND buyer_profile_id = auth.uid()
);
