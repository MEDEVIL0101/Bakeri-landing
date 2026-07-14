-- Guest custom-order inquiries from the public web (bakeriapp.com/baker/).
-- A stranger with no Bakeri account can now fill out a baker's intake form
-- for a listing and submit it as a lead — inserted by the
-- submit-custom-order-inquiry edge function (service_role) as a normal
-- marketplace pending_quote order with buyer_profile_id left NULL, exactly
-- like an in-app quote request, so the existing Orders inbox / notify
-- trigger / invoice-payment flow all just work without baker-side changes.
--
-- RLS already blocks anonymous inserts into orders/order_items (the only
-- INSERT policies require buyer_profile_id = auth.uid()), so no grant
-- changes are needed here — the edge function's service role is inherently
-- the only writer for these guest rows.

-- 1. Expose intake_form_id on the public baker-profile RPCs so the web page
--    can tell which listings have a custom form attached (and therefore
--    show a "Request a custom order" button).

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
            follower_count
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
            intake_form_id
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
            follower_count
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
            intake_form_id
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

-- 2. Columns to identify + rate-limit guest web leads. Nullable, untouched
--    by the existing authenticated in-app insert paths.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS lead_channel TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ip_address INET;

-- 3. Rate limit: cap guest web inquiries per IP, same shape as
--    enforce_vendor_application_limits(). Scoped via WHEN so it never runs
--    for the existing authenticated marketplace/manual insert paths.

CREATE OR REPLACE FUNCTION public.enforce_web_inquiry_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
  v_recent  int;
BEGIN
  IF NEW.ip_address IS NULL THEN
    BEGIN
      v_headers := current_setting('request.headers', true)::jsonb;
      NEW.ip_address := NULLIF(TRIM(COALESCE(
        v_headers->>'cf-connecting-ip',
        v_headers->>'x-real-ip',
        SPLIT_PART(v_headers->>'x-forwarded-for', ',', 1)
      )), '')::inet;
    EXCEPTION WHEN OTHERS THEN
      NEW.ip_address := NULL;
    END;
  END IF;

  IF NEW.ip_address IS NOT NULL THEN
    SELECT COUNT(*) INTO v_recent
    FROM public.orders
    WHERE ip_address = NEW.ip_address
      AND lead_channel = 'website'
      AND created_at > NOW() - INTERVAL '24 hours';

    IF v_recent >= 5 THEN
      RAISE EXCEPTION 'Too many inquiries submitted recently. Please try again later.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_web_inquiry_limits ON public.orders;
CREATE TRIGGER trg_web_inquiry_limits
BEFORE INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.buyer_profile_id IS NULL AND NEW.lead_channel = 'website')
EXECUTE FUNCTION public.enforce_web_inquiry_limits();
