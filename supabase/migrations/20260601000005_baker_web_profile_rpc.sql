-- ==========================================================================
-- get_baker_web_profile(p_handle)
--
-- Called by the public bakeriapp.com/baker/ web page (anon key).
-- Returns the baker's public profile + marketplace listings in one call,
-- bypassing the auth requirement on menu_items (which is correct for
-- in-app browsing) so non-app visitors can see listings before downloading.
--
-- Only exposes data that is already intentionally public:
--   - Profile fields that anon can SELECT (per column-level grants)
--   - Menu items that are listed AND active (same filter as in-app)
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.get_baker_web_profile(p_handle TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_baker_id UUID;
    v_profile  JSON;
    v_listings JSON;
BEGIN
    SELECT id INTO v_baker_id
    FROM public.profiles
    WHERE LOWER(TRIM(community_handle)) = LOWER(TRIM(p_handle))
    LIMIT 1;

    IF v_baker_id IS NULL THEN
        RETURN NULL;
    END IF;

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
        WHERE id = v_baker_id
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
            unit
        FROM public.menu_items
        WHERE user_id = v_baker_id
          AND is_listed_in_marketplace = true
          AND is_active = true
    ) l;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_baker_web_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile(TEXT) TO authenticated;
