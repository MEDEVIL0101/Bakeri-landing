-- The baker's local sync (SyncService.pullOrders) is incremental — it only
-- re-fetches orders whose updated_at moved since the last sync. A new
-- order_messages row doesn't touch the parent order's updated_at at all, so
-- the newly-added messageCount would never reach the baker's device short of
-- a full resync. Touch updated_at on new messages so it's picked up like any
-- other order change.

CREATE OR REPLACE FUNCTION public.touch_order_on_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE orders SET updated_at = now() WHERE id = NEW.order_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_order_on_new_message ON order_messages;
CREATE TRIGGER trg_touch_order_on_new_message
AFTER INSERT ON order_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_order_on_new_message();
