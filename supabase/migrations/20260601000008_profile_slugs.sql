-- profile_slug: URL-friendly identifier generated from business_name.
-- Replaces community_handle as the basis for shareable baker URLs.
-- Format: bakeriapp.com/baker/?slug=tillys-sugar-cookies

-- 1. Add column (nullable initially so backfill can run without constraints)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS profile_slug TEXT;

-- 2. Slugify helper: lowercase, collapse non-alphanumeric runs to hyphens, trim
CREATE OR REPLACE FUNCTION public.slugify(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT TRIM(BOTH '-' FROM
        regexp_replace(
            LOWER(COALESCE(raw, '')),
            '[^a-z0-9]+', '-', 'g'
        )
    );
$$;

-- 3. Unique slug assignment — called from trigger and used for backfill
CREATE OR REPLACE FUNCTION public.assign_profile_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    base      TEXT;
    candidate TEXT;
    suffix    INT := 2;
BEGIN
    -- Skip if business_name unchanged and slug already set
    IF NEW.profile_slug IS NOT NULL
       AND (TG_OP = 'UPDATE' AND OLD.business_name IS NOT DISTINCT FROM NEW.business_name)
    THEN
        RETURN NEW;
    END IF;

    base := public.slugify(NEW.business_name);
    IF base = '' THEN base := public.slugify(NEW.user_name); END IF;
    IF base = '' THEN base := 'baker'; END IF;

    candidate := base;
    WHILE EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profile_slug = candidate AND id IS DISTINCT FROM NEW.id
    ) LOOP
        candidate := base || '-' || suffix;
        suffix    := suffix + 1;
    END LOOP;

    NEW.profile_slug := candidate;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profile_slug
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.assign_profile_slug();

-- 4. Backfill existing rows (trigger won't fire on historical data)
DO $$
DECLARE
    r   RECORD;
    base      TEXT;
    candidate TEXT;
    suffix    INT;
BEGIN
    FOR r IN SELECT id, business_name, user_name FROM public.profiles WHERE profile_slug IS NULL LOOP
        base := public.slugify(r.business_name);
        IF base = '' THEN base := public.slugify(r.user_name); END IF;
        IF base = '' THEN base := 'baker'; END IF;
        candidate := base;
        suffix    := 2;
        WHILE EXISTS (SELECT 1 FROM public.profiles WHERE profile_slug = candidate AND id != r.id) LOOP
            candidate := base || '-' || suffix;
            suffix    := suffix + 1;
        END LOOP;
        UPDATE public.profiles SET profile_slug = candidate WHERE id = r.id;
    END LOOP;
END;
$$;

-- 5. Now enforce uniqueness
ALTER TABLE public.profiles ADD CONSTRAINT profiles_profile_slug_unique UNIQUE (profile_slug);

-- 6. Grant SELECT on profile_slug to both roles (it's a public-facing field)
GRANT SELECT (profile_slug) ON public.profiles TO anon;
GRANT SELECT (profile_slug) ON public.profiles TO authenticated;

-- 7. RPC: look up baker web profile by slug
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
            unit
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

REVOKE ALL ON FUNCTION public.get_baker_web_profile_by_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile_by_slug(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_baker_web_profile_by_slug(TEXT) TO authenticated;
