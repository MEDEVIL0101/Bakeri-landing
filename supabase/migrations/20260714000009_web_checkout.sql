-- Guest "Buy Now" checkout, part 1: expose pre-order scheduling fields on
-- the public web-profile RPCs, and extend the existing marketplace
-- status-change trigger to also email guest (web, no-account) buyers —
-- additive only, no existing branch behavior changed. The push-notification
-- calls already in these branches already no-op harmlessly for a null
-- buyer_profile_id (notify-marketplace's `.filter(Boolean)`), so guest
-- orders get the baker-facing "new order" push for free with zero changes.

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_slug(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_profile  JSON;
    v_listings JSON;
BEGIN
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE profile_slug = LOWER(TRIM(p_slug))
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT row_to_json(p) INTO v_profile
    FROM (
        SELECT
            id,
            user_name,
            business_name,
            profile_slug,
            bio,
            specialty_tags,
            location,
            pickup_city,
            pickup_province,
            follower_count,
            selected_theme,
            background_pattern
        FROM public.profiles
        WHERE id = v_user_id
    ) p;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            id,
            name,
            item_description,
            category,
            listing_kind,
            CASE WHEN marketplace_price_from > 0
                 THEN marketplace_price_from
                 ELSE default_price
            END AS price,
            available_qty_today,
            unit,
            intake_form_id,
            use_drop_date,
            preorder_drop_date,
            max_preorder_quantity
        FROM public.menu_items
        WHERE user_id = v_user_id
          AND is_listed_in_marketplace = true
          AND is_active = true
    ) l;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_id(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_profile  JSON;
    v_listings JSON;
BEGIN
    SELECT row_to_json(p) INTO v_profile
    FROM (
        SELECT
            id,
            user_name,
            business_name,
            community_handle,
            bio,
            specialty_tags,
            location,
            pickup_city,
            pickup_province,
            follower_count,
            selected_theme,
            background_pattern
        FROM public.profiles
        WHERE id = p_user_id
    ) p;

    IF v_profile IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            id,
            name,
            item_description,
            category,
            listing_kind,
            CASE WHEN marketplace_price_from > 0
                 THEN marketplace_price_from
                 ELSE default_price
            END AS price,
            available_qty_today,
            unit,
            intake_form_id,
            use_drop_date,
            preorder_drop_date,
            max_preorder_quantity
        FROM public.menu_items
        WHERE user_id = p_user_id
          AND is_listed_in_marketplace = true
          AND is_active = true
    ) l;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json)
    );
END;
$$;

-- Shared helper for calling the new guest-order-email edge functions from a
-- trigger. Mirrors send_marketplace_notification's shape
-- (20260524000003_marketplace_push_triggers.sql) but sources the webhook
-- secret from Vault rather than a literal — that migration's own hardcoded
-- secret is the exact anti-pattern documented (and fixed) in
-- 20260713000004_schedule_baker_payouts.sql after a real leak incident.
CREATE OR REPLACE FUNCTION public.call_guest_order_webhook(
    p_function_name TEXT,
    p_order_id      UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM extensions.http_post(
        url     := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/' || p_function_name,
        headers := jsonb_build_object(
            'Content-Type',      'application/json',
            'x-webhook-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1)
        ),
        body    := jsonb_build_object('order_id', p_order_id)::TEXT
    );
END;
$$;

-- CREATE OR REPLACE of the existing trigger function — every branch below
-- down to the two new IF blocks (marked) is unchanged from
-- 20260524000003_marketplace_push_triggers.sql.
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

      -- NEW: guest (web, no account) buyer — send the confirmed/QR email.
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

      -- NEW: guest (web, no account) buyer — issue the actual refund and
      -- email them (this makes "you won't be charged" true for guest
      -- orders; see plan notes on the pre-existing gap for in-app orders).
      IF NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website' THEN
        PERFORM public.call_guest_order_webhook('refund-and-notify-guest-order-declined', NEW.id);
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
