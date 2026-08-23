-- Redesigns the physical ("ships to you") marketplace-order lifecycle.
-- Until now mark-order-shipped collapsed 'awaiting_shipment' straight into
-- 'completed', giving the baker/buyer no distinction between "shipped" and
-- "delivered", and no way to refund an order after any fulfillment progress
-- without pretending it was a pre-fulfillment cancellation (cancel-order's
-- allowlist explicitly excluded 'awaiting_shipment'/'completed').
--
-- Adds two new mid-flow statuses ('preparing', 'shipped') plus two new
-- terminal statuses: 'delivered' (physical orders' equivalent of
-- 'completed') and 'refunded' (distinct from 'cancelled', which stays
-- "voided before any fulfillment progress").
--
-- 'awaiting_shipment' keeps its existing raw value (relabeled "Paid" only in
-- the Swift displayName layer) since finalize-guest-physical-order and this
-- same constraint already depend on the literal string.

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
        'out_for_delivery',
        'awaiting_shipment',
        'preparing',
        'shipped',
        'delivered',
        'refunded',
        'completed'
    ));

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refunded_at  TIMESTAMPTZ;
