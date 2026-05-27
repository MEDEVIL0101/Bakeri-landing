-- Delivery flow for ready-now marketplace orders.
-- Adds delivery columns to orders and order_items, widens the status
-- constraint to include out_for_delivery, and updates push notifications.

-- ── orders ───────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS is_delivery           BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS delivery_address      TEXT,
ADD COLUMN IF NOT EXISTS delivery_window_start TEXT,
ADD COLUMN IF NOT EXISTS delivery_window_end   TEXT;

-- ── order_items ──────────────────────────────────────────────────────────────
-- The create-marketplace-orders edge function sends wants_delivery per item.
-- Storing it here lets a trigger propagate is_delivery up to the parent order.

ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS wants_delivery BOOLEAN NOT NULL DEFAULT FALSE;

-- Propagate delivery flag from items to parent order
CREATE OR REPLACE FUNCTION trg_fn_propagate_delivery_flag()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.wants_delivery = TRUE THEN
    UPDATE orders SET is_delivery = TRUE WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_delivery_flag ON order_items;
CREATE TRIGGER trg_propagate_delivery_flag
AFTER INSERT OR UPDATE OF wants_delivery ON order_items
FOR EACH ROW EXECUTE FUNCTION trg_fn_propagate_delivery_flag();

-- ── marketplace_status constraint ────────────────────────────────────────────

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
        'completed'
    ));

-- ── push notifications (updated trigger function) ────────────────────────────

CREATE OR REPLACE FUNCTION trg_fn_marketplace_order_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_baker_id  UUID := COALESCE(NEW.user_id, OLD.user_id);
  v_buyer_id  UUID := COALESCE(NEW.buyer_profile_id, OLD.buyer_profile_id);
  v_name      TEXT := COALESCE(NEW.order_name, OLD.order_name, 'your order');
  v_baker_nm  TEXT := COALESCE(NEW.baker_display_name, OLD.baker_display_name, 'the baker');
  v_buyer_nm  TEXT := COALESCE(NEW.buyer_display_name, OLD.buyer_display_name, 'a customer');
  v_old_ms    TEXT := OLD.marketplace_status;
  v_new_ms    TEXT := NEW.marketplace_status;
  v_is_del    BOOL := COALESCE(NEW.is_delivery, FALSE);
  v_win_start TEXT := NEW.delivery_window_start;
  v_win_end   TEXT := NEW.delivery_window_end;
BEGIN
  -- ── INSERT ────────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' AND NEW.order_source = 'marketplace' THEN

    IF v_new_ms = 'pending' THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        CASE WHEN v_is_del THEN '🚚 New Delivery Order!' ELSE '🛍️ New Order!' END,
        v_buyer_nm || ' ordered ' || v_name,
        jsonb_build_object('type', 'new_order', 'order_id', NEW.id)
      );

    ELSIF v_new_ms = 'pending_quote' THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        '✏️ New Quote Request',
        v_buyer_nm || ' is requesting a custom quote',
        jsonb_build_object('type', 'new_quote_request', 'order_id', NEW.id)
      );
    END IF;

    RETURN NEW;
  END IF;

  -- ── UPDATE: marketplace_status changed ────────────────────────────────────
  IF TG_OP = 'UPDATE'
    AND NEW.order_source = 'marketplace'
    AND v_old_ms IS DISTINCT FROM v_new_ms
  THEN
    -- Baker confirmed → notify buyer
    IF v_old_ms = 'pending' AND v_new_ms = 'confirmed' THEN
      IF v_is_del AND v_win_start IS NOT NULL AND v_win_end IS NOT NULL THEN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '🎉 Order Confirmed!',
          v_baker_nm || ' accepted your order. Delivery: ' || v_win_start || '–' || v_win_end,
          jsonb_build_object('type', 'order_confirmed', 'order_id', NEW.id)
        );
      ELSE
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '🎉 Order Confirmed!',
          v_baker_nm || ' accepted your order for ' || v_name,
          jsonb_build_object('type', 'order_confirmed', 'order_id', NEW.id)
        );
      END IF;

    -- Baker declined → notify buyer
    ELSIF v_new_ms = 'declined' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        'Order Update',
        v_baker_nm || ' was unable to fulfil your order. You won''t be charged.',
        jsonb_build_object('type', 'order_declined', 'order_id', NEW.id)
      );

    -- Baker provided quote → notify buyer
    ELSIF v_old_ms = 'pending_quote' AND v_new_ms = 'quote_provided' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '💬 Quote Ready',
        v_baker_nm || ' sent you a quote for ' || v_name,
        jsonb_build_object('type', 'quote_provided', 'order_id', NEW.id)
      );

    -- Buyer paid quote → notify baker
    ELSIF v_old_ms = 'quote_provided' AND v_new_ms = 'confirmed' THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        '💳 Payment Received',
        v_buyer_nm || ' paid and confirmed their order for ' || v_name,
        jsonb_build_object('type', 'quote_paid', 'order_id', NEW.id)
      );

    -- Order ready for pickup → notify buyer
    ELSIF v_new_ms = 'ready_for_pickup' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '🛍️ Ready for Pickup!',
        v_name || ' is ready to collect from ' || v_baker_nm,
        jsonb_build_object('type', 'ready_for_pickup', 'order_id', NEW.id)
      );

    -- Baker out for delivery → notify buyer
    ELSIF v_new_ms = 'out_for_delivery' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '🚚 On the Way!',
        v_baker_nm || ' is out for delivery — your order is on its way!',
        jsonb_build_object('type', 'out_for_delivery', 'order_id', NEW.id)
      );

    -- Both confirmed → notify both (completion)
    ELSIF v_new_ms = 'completed' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '✅ Order Complete',
        'Your order of ' || v_name || ' is done. Enjoy!',
        jsonb_build_object('type', 'order_completed', 'order_id', NEW.id),
        v_baker_id
      );

    -- Buyer cancelled → notify baker
    ELSIF v_new_ms = 'cancelled' THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        'Order Cancelled',
        v_buyer_nm || ' cancelled their order for ' || v_name,
        jsonb_build_object('type', 'order_cancelled', 'order_id', NEW.id)
      );

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger definition itself hasn't changed, but recreate it to be safe.
DROP TRIGGER IF EXISTS trg_marketplace_order_notify ON orders;
CREATE TRIGGER trg_marketplace_order_notify
AFTER INSERT OR UPDATE OF marketplace_status ON orders
FOR EACH ROW EXECUTE FUNCTION trg_fn_marketplace_order_notify();
