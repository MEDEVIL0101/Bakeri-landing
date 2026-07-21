-- Adds guest-order transactional emails for the two marketplace_status
-- transitions that had push notifications but no email: ready_for_pickup
-- and cancelled ("Order Placed"/"Order Confirmed" already fire via
-- send-guest-order-received-email / send-guest-order-confirmed-email).
--
-- Same guest-only guard as the confirmed/quote_provided branches
-- (NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website') rather
-- than the wider payment_intent_id check the declined branch uses --
-- that widening was about the Stripe refund side effect specific to
-- declines, not email delivery. In-app buyers already get an equivalent
-- push notification a few lines above in each of these same branches.
--
-- Wrapped in the same exception-swallowing BEGIN/EXCEPTION blocks as every
-- other call in this trigger (20260720000001) so a Resend/webhook failure
-- can never block the real status-change transaction.

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
      BEGIN
        PERFORM send_marketplace_notification(
          v_baker_id,
          '🛍️ New Order!',
          v_buyer_nm || ' ordered ' || v_name,
          jsonb_build_object('type', 'new_order', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (new_order) failed for order %: %', NEW.id, SQLERRM;
      END;

    ELSIF v_new_ms = 'pending_quote' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_baker_id,
          '✏️ New Quote Request',
          v_buyer_nm || ' is requesting a custom quote',
          jsonb_build_object('type', 'new_quote_request', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (new_quote_request) failed for order %: %', NEW.id, SQLERRM;
      END;
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
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '🎉 Order Confirmed!',
          v_baker_nm || ' accepted your order for ' || v_name,
          jsonb_build_object('type', 'order_confirmed', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (order_confirmed) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-order-confirmed-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-order-confirmed-email) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

    -- Baker declined (or the order expired unanswered) → notify buyer and
    -- release/refund the Stripe hold. Applies to any marketplace order with
    -- a payment_intent_id, guest or in-app -- see migration header.
    ELSIF v_new_ms = 'declined' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          'Order Update',
          v_baker_nm || ' was unable to fulfil your order. You won''t be charged.',
          jsonb_build_object('type', 'order_declined', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (order_declined) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.payment_intent_id IS NOT NULL THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('refund-and-notify-guest-order-declined', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (refund-and-notify-guest-order-declined) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

    -- Baker sent a quote → notify buyer (email for a guest, push for an
    -- in-app buyer)
    ELSIF v_old_ms = 'pending_quote' AND v_new_ms = 'quote_provided' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '💬 Quote Ready',
          v_baker_nm || ' sent you a quote for ' || v_name,
          jsonb_build_object('type', 'quote_provided', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (quote_provided) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-quote-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-quote-email) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

    -- Buyer paid quote → notify baker
    ELSIF v_old_ms = 'quote_provided' AND v_new_ms = 'confirmed' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_baker_id,
          '💳 Payment Received',
          v_buyer_nm || ' paid and confirmed their order for ' || v_name,
          jsonb_build_object('type', 'quote_paid', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (quote_paid) failed for order %: %', NEW.id, SQLERRM;
      END;

    -- Order ready for pickup → notify buyer
    ELSIF v_new_ms = 'ready_for_pickup' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '🛍️ Ready for Pickup!',
          v_name || ' is ready to collect from ' || v_baker_nm,
          jsonb_build_object('type', 'ready_for_pickup', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (ready_for_pickup) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-order-ready-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-order-ready-email) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

    -- Order completed (both confirmed pickup) → notify both
    ELSIF v_new_ms = 'completed' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          '✅ Order Complete',
          'Your order of ' || v_name || ' is done. Enjoy!',
          jsonb_build_object('type', 'order_completed', 'order_id', NEW.id),
          v_baker_id
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (order_completed) failed for order %: %', NEW.id, SQLERRM;
      END;

    -- Buyer cancelled → notify baker (and the buyer, by email, if guest)
    ELSIF v_new_ms = 'cancelled' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_baker_id,
          'Order Cancelled',
          v_buyer_nm || ' cancelled their order for ' || v_name,
          jsonb_build_object('type', 'order_cancelled', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (order_cancelled) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-order-cancelled-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-order-cancelled-email) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;
