-- Two things in one migration:
--
-- 1. Fix a regression: 20260715000003 (fixing the extensions.http_post vs
--    net.http_post schema bug) accidentally dropped the apikey/Authorization
--    headers that 20260714000012 had added to call_guest_order_webhook to
--    satisfy the platform's JWT gate (these functions are deployed WITHOUT
--    --no-verify-jwt by deliberate choice). Since then, every guest
--    order-confirmed/declined-refund email call has likely been rejected
--    with 401 before it even reached the function's own webhook-secret
--    check. Restoring both fixes together this time.
--
-- 2. New: a public-safe RPC for the guest quote-payment page, and a new
--    trigger branch that emails a guest their quote (with a pay link) when
--    the baker moves a request from pending_quote -> quote_provided — this
--    transition previously had no notification path at all for a guest,
--    since push notifications no-op for a null buyer_profile_id and there
--    was never an email wired up for it.

CREATE OR REPLACE FUNCTION public.call_guest_order_webhook(
    p_function_name TEXT,
    p_order_id      UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
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

-- Public-safe: only ever returns guest/website orders, and only the fields
-- baker/pay-quote.html needs to render a quote + know whether it's already
-- been paid/retracted/declined.
CREATE OR REPLACE FUNCTION public.get_guest_quote_details(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'order_id',           o.id,
        'order_name',         o.order_name,
        'customer_name',      o.customer_name,
        'quoted_price',       o.quoted_price,
        'quote_note',         o.quote_note,
        'marketplace_status', o.marketplace_status,
        'is_paid',            o.is_paid,
        'business_name',      COALESCE(NULLIF(p.business_name, ''), p.user_name, 'Your baker')
    ) INTO v_result
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.user_id
    WHERE o.id = p_order_id
      AND o.buyer_profile_id IS NULL
      AND o.lead_channel = 'website';

    RETURN v_result;
END;
$$;

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

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        PERFORM public.call_guest_order_webhook('send-guest-order-confirmed-email', NEW.id);
      END IF;

    -- Baker declined → notify buyer
    ELSIF v_new_ms = 'declined' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        'Order Update',
        v_baker_nm || ' was unable to fulfil your order. You won''t be charged.',
        jsonb_build_object('type', 'order_declined', 'order_id', NEW.id)
      );

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        PERFORM public.call_guest_order_webhook('refund-and-notify-guest-order-declined', NEW.id);
      END IF;

    -- NEW: Baker sent a quote → notify buyer (email for a guest, push for an
    -- in-app buyer — send_marketplace_notification already no-ops harmlessly
    -- for a null recipient either way).
    ELSIF v_old_ms = 'pending_quote' AND v_new_ms = 'quote_provided' THEN
      PERFORM send_marketplace_notification(
        v_buyer_id,
        '💬 Quote Ready',
        v_baker_nm || ' sent you a quote for ' || v_name,
        jsonb_build_object('type', 'quote_provided', 'order_id', NEW.id)
      );

      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        PERFORM public.call_guest_order_webhook('send-guest-quote-email', NEW.id);
      END IF;

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
