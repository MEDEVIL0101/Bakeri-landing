-- Lets a baker set a custom About heading ("Meet Juliana", "More about
-- Juliana") distinct from business_name -- the about story is often about
-- the *person* behind the bakery, not the business brand, so it shouldn't be
-- forced through a business-name-derived label. The section nav always just
-- says "About" (unaffected by this column); only the on-page heading once
-- you're in that section reflects it. Empty means the storefront falls back
-- to a plain "About".

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS about_heading TEXT NOT NULL DEFAULT '';

GRANT SELECT (about_heading) ON public.profiles TO anon;
GRANT SELECT (about_heading) ON public.profiles TO authenticated;

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
            about_heading,
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
            about_heading,
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
