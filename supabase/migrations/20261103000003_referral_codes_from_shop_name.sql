-- Referral codes from the shop name (Harvey 2026-11-02): part of the shop
-- name plus a number — "Sugarland Bakery Co." → SUGARLAND24 — instead of six
-- random characters, and made automatically (the apps no longer ask the
-- vendor to "get" a code).

-- The name part: as many whole words of the shop name as fit in 14
-- characters (letters/digits only) — "Cakes By Eve" → CAKESBYEVE,
-- "Jo's Storybook Bakery" → JOSSTORYBOOK — always at least the first word
-- (cut to 14). Falls back to the storefront slug, then the user name.
CREATE OR REPLACE FUNCTION public.referral_code_stem(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_src  TEXT;
    v_word TEXT;
    v_stem TEXT := '';
BEGIN
    FOR v_src IN
        SELECT x FROM (
            SELECT 1 AS n, business_name AS x FROM public.profiles WHERE id = p_user_id
            UNION ALL SELECT 2, profile_slug FROM public.profiles WHERE id = p_user_id
            UNION ALL SELECT 3, user_name FROM public.profiles WHERE id = p_user_id
        ) s WHERE x IS NOT NULL ORDER BY n
    LOOP
        v_stem := '';
        FOREACH v_word IN ARRAY regexp_split_to_array(TRIM(v_src), '[\s\-_]+') LOOP
            v_word := UPPER(REGEXP_REPLACE(v_word, '[^A-Za-z0-9]', '', 'g'));
            CONTINUE WHEN v_word = '';
            IF v_stem = '' THEN
                v_stem := LEFT(v_word, 14);
            ELSIF LENGTH(v_stem) + LENGTH(v_word) <= 14 THEN
                v_stem := v_stem || v_word;
            ELSE
                EXIT;
            END IF;
        END LOOP;
        IF LENGTH(v_stem) >= 3 THEN
            RETURN v_stem;
        END IF;
    END LOOP;
    RETURN 'BAKERI';
END;
$$;

-- Makes (or returns) the vendor's code: stem + two digits, three if the
-- two-digit ones keep colliding. Callers check eligibility first.
CREATE OR REPLACE FUNCTION public.make_referral_code(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code    TEXT;
    v_stem    TEXT := COALESCE(public.referral_code_stem(p_user_id), 'BAKERI');
    v_attempt INTEGER := 0;
BEGIN
    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = p_user_id;
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;
    LOOP
        v_attempt := v_attempt + 1;
        v_code := v_stem || CASE WHEN v_attempt <= 20
            THEN (10 + floor(random() * 90))::int::text
            ELSE (100 + floor(random() * 900))::int::text END;
        BEGIN
            INSERT INTO public.referral_codes (user_id, code) VALUES (p_user_id, v_code);
            RETURN v_code;
        EXCEPTION WHEN unique_violation THEN
            SELECT code INTO v_code FROM public.referral_codes WHERE user_id = p_user_id;
            IF v_code IS NOT NULL THEN
                RETURN v_code;
            END IF;
            IF v_attempt >= 60 THEN
                RAISE EXCEPTION 'Could not allocate a referral code — please try again';
            END IF;
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_code_stem(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.make_referral_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_code_stem(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.make_referral_code(UUID) TO service_role;

-- The vendor's own code (Referral Program, builder): same checks as before.
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF NOT public.referrer_has_active_plan(v_uid) THEN
        RAISE EXCEPTION 'You need an active Bakeri plan to join the referral program'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN public.make_referral_code(v_uid);
END;
$$;

-- The storefront card's code: unchanged rules, new codes from the name.
CREATE OR REPLACE FUNCTION public.storefront_referral_code(p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code     TEXT;
    v_disabled TIMESTAMPTZ;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p,
             jsonb_array_elements(COALESCE(p.storefront_design->'blocks', '[]'::jsonb)) b
        WHERE p.id = p_profile_id
          AND b->>'type' = 'referral'
          AND COALESCE((b->>'hidden')::boolean, FALSE) = FALSE
    ) THEN
        RETURN NULL;
    END IF;
    IF NOT public.referrer_has_active_plan(p_profile_id) THEN
        RETURN NULL;
    END IF;
    SELECT code, disabled_at INTO v_code, v_disabled
      FROM public.referral_codes WHERE user_id = p_profile_id;
    IF FOUND THEN
        RETURN CASE WHEN v_disabled IS NULL THEN v_code END;  -- none when an admin disabled it
    END IF;
    RETURN public.make_referral_code(p_profile_id);
END;
$$;

-- The two random codes made before this (no referrals used them): replace
-- with name-based ones.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT rc.user_id FROM public.referral_codes rc
        WHERE rc.code IN ('TY2BKR', '3JUP37')
          AND NOT EXISTS (SELECT 1 FROM public.referrals x WHERE UPPER(x.referral_code) = UPPER(rc.code))
          AND NOT EXISTS (SELECT 1 FROM public.vendor_applications a WHERE UPPER(a.referral_code) = UPPER(rc.code))
    LOOP
        DELETE FROM public.referral_codes WHERE user_id = r.user_id;
        PERFORM public.make_referral_code(r.user_id);
    END LOOP;
END $$;

-- Every vendor with an active plan gets their code now.
SELECT public.make_referral_code(p.id)
FROM public.profiles p
WHERE public.referrer_has_active_plan(p.id)
  AND NOT EXISTS (SELECT 1 FROM public.referral_codes rc WHERE rc.user_id = p.id);
