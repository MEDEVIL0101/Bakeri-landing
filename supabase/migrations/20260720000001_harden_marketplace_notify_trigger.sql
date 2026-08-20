-- Root-cause fix for "baker can't accept order" (2026-07-20 incident, order
-- 66d03135-bf01-4731-b078-9bbeae661297): a guest bought a $1 item, the baker
-- tried to accept within a minute and every attempt failed with "Could not
-- confirm order", the order sat at marketplace_status='pending' until the
-- 15-minute expiry cron auto-declined + refunded it.
--
-- Mechanism: 20260715000005_fix_marketplace_notification_hardcoded_secret.sql
-- switched send_marketplace_notification to read the webhook secret from
-- vault.decrypted_secrets, and call_guest_order_webhook already did the same
-- (20260714000009 / 20260715000004). NEITHER function is SECURITY DEFINER,
-- so when trg_fn_marketplace_order_notify fires as part of a baker's own
-- client-side UPDATE, that vault SELECT runs as the `authenticated` role --
-- which does not have grants on the vault schema (service_role/postgres
-- only, by design). The SELECT raises "permission denied", PERFORM doesn't
-- swallow it, and the exception aborts the entire trigering UPDATE.
--
-- This has broken EVERY client-initiated marketplace_status transition
-- (accept, decline, ready-for-pickup, cancel, completed -- not just guest
-- orders) since 2026-07-15. It's the first time anyone happened to exercise
-- a real baker-accept afterward, which is why it surfaced now.
--
-- Two independent fixes, both applied:
--   1. SECURITY DEFINER on the two vault-reading functions -- they now run
--      as their owner (which does have vault access), fixing the actual
--      permission problem.
--   2. Every notification/webhook call inside the trigger is wrapped in its
--      own exception-swallowing block, so a notification failure (this one,
--      or any future one -- a renamed function, a network blip, whatever)
--      can never again abort the real state change. Notifications are a
--      side effect; they must never be able to block the business
--      transaction that triggers them.

CREATE OR REPLACE FUNCTION send_marketplace_notification(
  p_recipient_user_id   UUID,
  p_title               TEXT,
  p_body                TEXT,
  p_data                JSONB         DEFAULT '{}',
  p_recipient_user_id_2 UUID          DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';
BEGIN
  PERFORM net.http_post(
    url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/notify-marketplace',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'apikey',             v_anon_key,
      'Authorization',      'Bearer ' || v_anon_key,
      'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
    ),
    body    := jsonb_build_object(
      'recipient_user_id',   p_recipient_user_id,
      'recipient_user_id_2', p_recipient_user_id_2,
      'title',               p_title,
      'body',                p_body,
      'data',                p_data
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.call_guest_order_webhook(
    p_function_name TEXT,
    p_order_id      UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';
BEGIN
    PERFORM net.http_post(
        url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/' || p_function_name,
        headers := jsonb_build_object(
            'Content-Type',      'application/json',
            'apikey',            v_anon_key,
            'Authorization',     'Bearer ' || v_anon_key,
            'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
        ),
        body    := jsonb_build_object('order_id', p_order_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION send_marketplace_notification(UUID, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_marketplace_notification(UUID, TEXT, TEXT, JSONB, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.call_guest_order_webhook(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.call_guest_order_webhook(TEXT, UUID) TO authenticated, service_role;

-- Belt-and-suspenders: even with the SECURITY DEFINER fix above, no future
-- notification/webhook addition to this trigger should ever be able to take
-- down a baker's or buyer's order-status update again.
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

    -- Baker declined → notify buyer
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

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
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

    -- Buyer cancelled → notify baker
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

    END IF;
  END IF;

  RETURN NEW;
END;
$$;
