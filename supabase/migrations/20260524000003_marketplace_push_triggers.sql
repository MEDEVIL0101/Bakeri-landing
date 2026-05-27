-- Marketplace push notification triggers.
-- Calls the notify-marketplace edge function via pg_net on every relevant event.

-- Enable pg_net (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─── Shared helper ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION send_marketplace_notification(
  p_recipient_user_id   UUID,
  p_title               TEXT,
  p_body                TEXT,
  p_data                JSONB         DEFAULT '{}',
  p_recipient_user_id_2 UUID          DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM extensions.http_post(
    url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/notify-marketplace',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  'fe1b0c413957b3fbe6a28f083d41a6dfcc065349f2017e668d8c46422ffcf1ca'
    ),
    body    := jsonb_build_object(
      'recipient_user_id',   p_recipient_user_id,
      'recipient_user_id_2', p_recipient_user_id_2,
      'title',               p_title,
      'body',                p_body,
      'data',                p_data
    )::TEXT
  );
END;
$$;

-- ─── Order events trigger ─────────────────────────────────────────────────────

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
BEGIN
  -- ── INSERT: new marketplace order arrives ──────────────────────────────────
  IF TG_OP = 'INSERT' AND NEW.order_source = 'marketplace' THEN

    IF v_new_ms = 'pending' THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        '🛍️ New Order!',
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
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '🎉 Order Confirmed!',
        v_baker_nm || ' accepted your order for ' || v_name,
        jsonb_build_object('type', 'order_confirmed', 'order_id', NEW.id)
      );

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

    -- Order completed (both confirmed pickup) → notify both
    ELSIF v_new_ms = 'completed' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '✅ Order Complete',
        'Your order of ' || v_name || ' is done. Enjoy!',
        jsonb_build_object('type', 'order_completed', 'order_id', NEW.id),
        v_baker_id   -- baker gets the same notification
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

DROP TRIGGER IF EXISTS trg_marketplace_order_notify ON orders;
CREATE TRIGGER trg_marketplace_order_notify
AFTER INSERT OR UPDATE OF marketplace_status ON orders
FOR EACH ROW EXECUTE FUNCTION trg_fn_marketplace_order_notify();

-- ─── Message events trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_fn_order_message_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_recipient   UUID;
  v_sender_name TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Route to the other party
  IF NEW.sender_profile_id = v_order.user_id THEN
    -- Baker sent → notify buyer
    v_recipient   := v_order.buyer_profile_id;
    v_sender_name := COALESCE(v_order.baker_display_name, 'Your baker');
  ELSE
    -- Buyer sent → notify baker
    v_recipient   := v_order.user_id;
    v_sender_name := COALESCE(v_order.buyer_display_name, 'A customer');
  END IF;

  IF v_recipient IS NOT NULL THEN
    PERFORM send_marketplace_notification(
      v_recipient,
      '💬 New Message',
      v_sender_name || ': ' || LEFT(NEW.message, 80),
      jsonb_build_object('type', 'new_message', 'order_id', NEW.order_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_message_notify ON order_messages;
CREATE TRIGGER trg_order_message_notify
AFTER INSERT ON order_messages
FOR EACH ROW EXECUTE FUNCTION trg_fn_order_message_notify();
