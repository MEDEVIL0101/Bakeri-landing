-- Physical (shipped) products — a fifth menu_items.listing_kind.
-- Reuses the whole existing menu_items/Stripe Connect/payout pipeline like
-- 'digital' did. Unlike digital, physical items are stock-bound: checkout
-- must atomically decrement available_qty_today and refuse to oversell.
-- Also adds a shipping_address column to orders — physical is the first
-- listing kind that actually needs a buyer-entered postal address, as
-- opposed to the existing delivery_address (local-delivery-only, never
-- populated by guest/web checkout).

-- MARK: menu_items — widen listing_kind

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_listing_kind_check;
ALTER TABLE public.menu_items
    ADD CONSTRAINT menu_items_listing_kind_check
    CHECK (listing_kind IN ('ready_now', 'preorder', 'custom', 'digital', 'physical'));

-- MARK: orders — shipping address (guest-checkout-collected, physical only)

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS shipping_address JSONB;

-- MARK: atomic stock decrement for instant-capture checkout
--
-- ready_now's only existing decrement is client-side, on baker accept
-- (MarketplaceOrderSheet.decrementInventory) — wrong model for a listing
-- kind that charges instantly with no accept step. This runs as one
-- Postgres transaction per call, so a mid-batch insufficient_stock failure
-- rolls back every decrement already applied in the same call — the
-- caller doesn't need to do any manual compensation.
--
-- p_items shape: [{"id": "<menu_item_id>", "qty": 2}, ...]

CREATE OR REPLACE FUNCTION public.decrement_menu_item_stock_batch(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec JSONB;
BEGIN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        UPDATE public.menu_items
        SET available_qty_today = available_qty_today - (rec->>'qty')::INTEGER
        WHERE id = (rec->>'id')::UUID
          AND available_qty_today >= (rec->>'qty')::INTEGER;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'insufficient_stock:%', rec->>'id';
        END IF;
    END LOOP;
END;
$$;

-- MARK: web-profile RPCs — add lead_days to the public listings feed
--
-- Needed so the storefront can show "Ships in N days" for a physical
-- listing (baker-set on AddEditMenuItemView, reusing the same leadDays
-- field preorder already uses for "N-day notice") — purely additive,
-- everything else about these two functions is unchanged from
-- 20260729000001_storefront_links_and_digital.sql.

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
    v_faqs     JSON;
    v_links    JSON;
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
            store_policies,
            about_story,
            neighbourhood,
            pickup_hours_json,
            specialty_tags,
            location,
            pickup_city,
            pickup_province,
            follower_count,
            selected_theme,
            background_pattern,
            is_gst_registered,
            stripe_connect_onboarding_complete
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
            allergens,
            lead_time_note,
            lead_days,
            CASE WHEN marketplace_price_from > 0
                 THEN marketplace_price_from
                 ELSE default_price
            END AS price,
            available_qty_today,
            unit,
            intake_form_id,
            use_drop_date,
            preorder_drop_date,
            max_preorder_quantity,
            tax_category,
            unit_weight_grams
        FROM public.menu_items
        WHERE user_id = v_user_id
          AND is_listed_in_marketplace = true
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = v_user_id
          AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT id, section, label, url, sort_order
        FROM public.baker_links
        WHERE user_id = v_user_id
          AND deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
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
    v_faqs     JSON;
    v_links    JSON;
BEGIN
    SELECT row_to_json(p) INTO v_profile
    FROM (
        SELECT
            id,
            user_name,
            business_name,
            profile_slug,
            bio,
            store_policies,
            about_story,
            neighbourhood,
            pickup_hours_json,
            specialty_tags,
            location,
            pickup_city,
            pickup_province,
            follower_count,
            selected_theme,
            background_pattern,
            is_gst_registered,
            stripe_connect_onboarding_complete
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
            allergens,
            lead_time_note,
            lead_days,
            CASE WHEN marketplace_price_from > 0
                 THEN marketplace_price_from
                 ELSE default_price
            END AS price,
            available_qty_today,
            unit,
            intake_form_id,
            use_drop_date,
            preorder_drop_date,
            max_preorder_quantity,
            tax_category,
            unit_weight_grams
        FROM public.menu_items
        WHERE user_id = p_user_id
          AND is_listed_in_marketplace = true
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = p_user_id
          AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT id, section, label, url, sort_order
        FROM public.baker_links
        WHERE user_id = p_user_id
          AND deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$$;
