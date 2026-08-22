-- Physical marketplace orders were being inserted straight into
-- marketplace_status='completed' the instant payment succeeded (same as
-- digital) — correct for digital (nothing left to do), wrong for physical
-- (the baker still owes the customer a shipment). OrdersView.activeOrders
-- filters out anything marketplace_status='completed', so every physical
-- sale landed straight in the Completed tab with no way to action it.
--
-- Adds 'awaiting_shipment' as the new post-payment, pre-ship state for
-- physical orders (finalize-guest-physical-order now inserts here instead
-- of 'completed'), and the columns mark-order-shipped writes once the baker
-- actually ships it and the order transitions to 'completed'.

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
        'completed'
    ));

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS tracking_number TEXT,
    ADD COLUMN IF NOT EXISTS shipping_carrier TEXT,
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
