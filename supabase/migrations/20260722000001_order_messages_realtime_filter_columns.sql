-- order_messages had nothing Realtime could filter on (only order_id and
-- sender_profile_id — neither identifies which two users should receive a
-- given message), so both Swift-side postgres_changes subscriptions on this
-- table (SyncService.startRealtime, BuyerOrdersView.subscribeToMessages)
-- were unfiltered: every message sent by ANYONE on the platform broadcasts
-- to EVERY currently-connected client, not just the two parties on that
-- order. This was the dominant driver of Realtime Messages usage.
--
-- Fix: denormalize the parent order's two parties (baker = orders.user_id,
-- buyer = orders.buyer_profile_id) onto each message row, auto-populated
-- server-side so clients can't spoof them. Each client can now filter
-- Realtime to baker_user_id=eq.<uid> or buyer_profile_id=eq.<uid> depending
-- on which role they're watching messages as.

ALTER TABLE order_messages
    ADD COLUMN IF NOT EXISTS baker_user_id    UUID,
    ADD COLUMN IF NOT EXISTS buyer_profile_id UUID;

-- Backfill existing rows from their parent order.
UPDATE order_messages m
SET baker_user_id    = o.user_id,
    buyer_profile_id = o.buyer_profile_id
FROM orders o
WHERE o.id = m.order_id
  AND (m.baker_user_id IS DISTINCT FROM o.user_id
       OR m.buyer_profile_id IS DISTINCT FROM o.buyer_profile_id);

CREATE OR REPLACE FUNCTION public.order_messages_set_parties()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
    SELECT o.user_id, o.buyer_profile_id
    INTO NEW.baker_user_id, NEW.buyer_profile_id
    FROM public.orders o
    WHERE o.id = NEW.order_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_messages_set_parties ON order_messages;
CREATE TRIGGER trg_order_messages_set_parties
    BEFORE INSERT ON order_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.order_messages_set_parties();

CREATE INDEX IF NOT EXISTS idx_order_messages_baker_user_id    ON order_messages (baker_user_id);
CREATE INDEX IF NOT EXISTS idx_order_messages_buyer_profile_id ON order_messages (buyer_profile_id);
