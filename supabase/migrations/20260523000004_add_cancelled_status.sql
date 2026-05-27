-- Add 'cancelled' as a valid marketplace_status (buyer-initiated cancellation)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_marketplace_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_marketplace_status_check
    CHECK (marketplace_status IS NULL OR marketplace_status IN (
        'pending', 'confirmed', 'declined', 'cancelled',
        'pending_quote', 'quote_provided'
    ));
