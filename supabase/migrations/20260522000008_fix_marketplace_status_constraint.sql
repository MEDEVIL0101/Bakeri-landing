-- The quote request flow (000007) introduced pending_quote and quote_provided
-- but never widened the check constraint from 000001.
-- Drop and recreate with all valid values.

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_marketplace_status_check;

ALTER TABLE orders
    ADD CONSTRAINT orders_marketplace_status_check
    CHECK (
        marketplace_status IS NULL
        OR marketplace_status IN (
            'pending',
            'confirmed',
            'declined',
            'pending_quote',
            'quote_provided'
        )
    );
