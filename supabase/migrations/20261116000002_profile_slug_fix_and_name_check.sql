-- Fix (2026-11-16): new vendors couldn't finish setup — "permission denied for
-- function slug_in_use". 20261115000008_partner_pages revoked slug_in_use from
-- authenticated, but the profiles trigger assign_profile_slug() runs as the
-- signed-in vendor and calls it. The trigger now runs as its owner, like the
-- other slug code, so slug_in_use stays private.
ALTER FUNCTION public.assign_profile_slug() SECURITY DEFINER;

-- Setup screen (Harvey 2026-11-16): is this business name's storefront
-- address free? If not, up to 3 names whose addresses are. The caller's own
-- profile never counts against them.
CREATE OR REPLACE FUNCTION public.check_business_name(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := btrim(coalesce(p_name, ''));
    v_base TEXT := public.slugify(v_name);
    v_out  TEXT[] := '{}';
    v_sfx  TEXT;
    v_cand TEXT;
    v_n    INT := 2;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF v_base = '' OR NOT public.slug_in_use(v_base, auth.uid()) THEN
        RETURN jsonb_build_object('taken', false, 'suggestions', '[]'::jsonb);
    END IF;

    FOREACH v_sfx IN ARRAY ARRAY['Bakery', 'Cookies', 'Bakes', 'Sweets', 'Treats', 'Kitchen', 'Bake Shop', 'Cakes', 'Co.'] LOOP
        EXIT WHEN coalesce(array_length(v_out, 1), 0) >= 3;
        CONTINUE WHEN position(lower(v_sfx) IN lower(v_name)) > 0;
        v_cand := v_name || ' ' || v_sfx;
        IF NOT public.slug_in_use(public.slugify(v_cand), auth.uid()) THEN
            v_out := v_out || v_cand;
        END IF;
    END LOOP;
    -- Still short (every word taken): numbered versions.
    WHILE coalesce(array_length(v_out, 1), 0) < 3 AND v_n < 50 LOOP
        v_cand := v_name || ' ' || v_n;
        IF NOT public.slug_in_use(public.slugify(v_cand), auth.uid()) THEN
            v_out := v_out || v_cand;
        END IF;
        v_n := v_n + 1;
    END LOOP;

    RETURN jsonb_build_object('taken', true, 'suggestions', to_jsonb(v_out));
END;
$$;
REVOKE ALL ON FUNCTION public.check_business_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_business_name(TEXT) TO authenticated;
