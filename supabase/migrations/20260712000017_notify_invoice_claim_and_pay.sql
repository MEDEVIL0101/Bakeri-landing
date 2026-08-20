-- claim_and_pay_invoice (20260712000014) takes a manual order straight from
-- marketplace_status = NULL to 'confirmed' in one step, which matches none
-- of the existing branches below (they all expect a 'pending'/'quote_provided'
-- starting point) — so the baker never got notified that an invoice they
-- handed out was paid. Add a branch for that specific transition.

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

    -- Invoice claimed + paid in one step (claim_and_pay_invoice) → notify baker
    ELSIF v_old_ms IS NULL AND v_new_ms = 'confirmed' AND NEW.buyer_profile_id IS NOT NULL THEN
      PERFORM send_marketplace_notification(
        v_baker_id,
        '💳 Invoice Paid',
        v_buyer_nm || ' paid your invoice for ' || v_name,
        jsonb_build_object('type', 'invoice_paid', 'order_id', NEW.id)
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
