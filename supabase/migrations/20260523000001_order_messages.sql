-- Threaded messaging between buyer and baker within a marketplace order.

CREATE TABLE order_messages (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender_profile_id UUID        NOT NULL,
    message           TEXT        NOT NULL CHECK (char_length(message) > 0 AND char_length(message) <= 2000),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;

-- Baker (orders.user_id) and buyer (orders.buyer_profile_id) can read their order's messages
CREATE POLICY "order_messages_select"
ON order_messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_messages.order_id
          AND (o.user_id = auth.uid() OR o.buyer_profile_id = auth.uid())
    )
);

-- Both parties can send messages on their own orders
CREATE POLICY "order_messages_insert"
ON order_messages FOR INSERT
WITH CHECK (
    sender_profile_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_messages.order_id
          AND (o.user_id = auth.uid() OR o.buyer_profile_id = auth.uid())
    )
);

CREATE INDEX idx_order_messages_order_id ON order_messages (order_id, created_at);
