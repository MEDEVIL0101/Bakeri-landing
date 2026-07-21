-- Bakers can now write free-text store policies (cancellation/refund terms,
-- pickup expectations, etc.) that render on their public web storefront
-- header, alongside their existing bio. Public, non-sensitive content —
-- unlike pickup_address this doesn't need the RPC-only restriction, it's
-- exposed the same way `bio` already is.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS store_policies TEXT NOT NULL DEFAULT '';

-- Extend anon/authenticated public-column grants (matches bio's treatment
-- in 20260601000003_profiles_column_security.sql) for any future direct
-- REST consumer, even though the web storefront reads this via the RPCs
-- below (which are SECURITY DEFINER and don't depend on these grants).
GRANT SELECT (store_policies) ON public.profiles TO anon;
GRANT SELECT (store_policies) ON public.profiles TO authenticated;

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
            store_policies,
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
            store_policies,
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

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json)
    );
END;
$$;
