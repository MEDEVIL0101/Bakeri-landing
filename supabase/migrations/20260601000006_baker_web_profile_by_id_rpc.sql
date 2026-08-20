-- get_baker_web_profile_by_id(p_user_id)
-- Same as get_baker_web_profile but looks up by UUID instead of handle.
-- Used by bakeriapp.com/baker/?id=UUID links (handle-free shareable URLs).

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
            unit
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

REVOKE ALL ON FUNCTION public.get_baker_web_profile_by_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile_by_id(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile_by_id(UUID) TO authenticated;
