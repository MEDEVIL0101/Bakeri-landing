-- Two gaps in guest-order notifications, both reported live 2026-08-02:
--
-- 1. Retracting a sent quote (quote_provided -> pending_quote) had NO
--    notification branch at all — the buyer was never told the quote they
--    were looking at got pulled back. New branch added below, mirroring the
--    quote_provided branch's push+email pattern, calling the new
--    send-guest-quote-retracted-email function for guest orders.
--
-- 2. Declining a quote request never emailed the guest buyer. The declined
--    branch's guest-order webhook call was narrowed in
--    20260720000004_expire_all_marketplace_orders_and_release_holds.sql to
--    `NEW.payment_intent_id IS NOT NULL` (that migration's actual goal was
--    making the Stripe refund/cancel side effect fire for in-app orders
--    too). But a quote request/quote-provided order never has a
--    payment_intent_id — nothing has been charged yet — so that guard
--    accidentally made quote declines skip the guest email entirely. Fixed
--    by OR-ing back in the guest-order condition so the webhook (and the
--    email inside refund-and-notify-guest-order-declined, which now also
--    includes the baker's decline_message and stops implying a refund when
--    nothing was ever charged) fires for every guest decline regardless of
--    payment stage, while still firing for the Stripe side effect whenever
--    a payment_intent_id exists.
--
-- Additive/adjusted only — every other branch is unchanged from the live
-- definition in 20260730000003_guest_order_placed_email_trigger.sql (which
-- itself confirmed byte-for-byte accuracy against pg_get_functiondef before
-- editing, per that file's header — this function has broken silently from
-- careless edits before, so each change here starts from that same
-- confirmed baseline).

CREATE OR REPLACE FUNCTION public.trg_fn_marketplace_order_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-order-received-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-order-received-email) failed for order %: %', NEW.id, SQLERRM;
        END;
      END IF;

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
    -- release/refund the Stripe hold. The guest-email/refund webhook fires
    -- whenever there's a payment to release (any order, guest or in-app)
    -- OR whenever there's a guest email to send (even a pre-payment quote
    -- decline, which has no payment_intent_id at all) — see migration
    -- header for why both conditions are needed.
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

      IF NEW.payment_intent_id IS NOT NULL
        OR (NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website')
      THEN
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

    -- Baker retracted a sent quote → notify buyer it's being revised (email
    -- for a guest, push for an in-app buyer). No payment exists at this
    -- stage either way, so there's nothing to refund/release.
    ELSIF v_old_ms = 'quote_provided' AND v_new_ms = 'pending_quote' THEN
      BEGIN
        PERFORM send_marketplace_notification(
          v_buyer_id,
          'Quote Update',
          v_baker_nm || ' is revising your quote for ' || v_name,
          jsonb_build_object('type', 'quote_retracted', 'order_id', NEW.id)
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'send_marketplace_notification (quote_retracted) failed for order %: %', NEW.id, SQLERRM;
      END;

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        BEGIN
          PERFORM public.call_guest_order_webhook('send-guest-quote-retracted-email', NEW.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'call_guest_order_webhook (send-guest-quote-retracted-email) failed for order %: %', NEW.id, SQLERRM;
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
$function$;
