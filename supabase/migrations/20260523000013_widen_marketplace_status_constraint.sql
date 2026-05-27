-- ready_for_pickup and completed were never added to the check constraint,
-- blocking the baker from marking orders ready and the pickup handshake from completing.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_marketplace_status_check;

ALTER TABLE orders
    ADD CONSTRAINT orders_marketplace_status_check
    CHECK (marketplace_status IS NULL OR marketplace_status IN (
        'pending',
        'confirmed',
        'declined',
        'cancelled',
        'pending_quote',
        'quote_provided',
        'ready_for_pickup',
        'completed'
    ));
