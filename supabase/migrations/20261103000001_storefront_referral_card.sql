-- Bakerï Referral card on storefronts (Harvey 2026-11-02).
-- A vendor can show a card on their storefront inviting other makers to
-- Bakerï with their referral code; a vendor who signs up with a code gets
-- 10% off their first 3 months (create-plan-checkout, Stripe coupon
-- BAKERI_REFERRAL_10).
--
-- The card is a storefront_design block {type: "referral"}. It is never one
-- of the page's default cards, so it only shows where the vendor's own
-- design includes it switched on. Existing storefronts get it added
-- switched off (below); new shops' builders start with it on.

-- The vendor's referral code, for their storefront's referral card. Public
-- (the storefront page is anonymous), but only answers while that vendor's
-- published storefront shows the card and they have an active plan — so it
-- can't be used to look up codes for vendors who aren't showing one.
-- Creates the code on first use, like get_or_create_referral_code().
CREATE OR REPLACE FUNCTION public.storefront_referral_code(p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code     TEXT;
    v_disabled TIMESTAMPTZ;
    v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no I O L 0 1
    v_attempt  INTEGER := 0;
    i          INTEGER;
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

    LOOP
        v_attempt := v_attempt + 1;
        v_code := '';
        FOR i IN 1..6 LOOP
            v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
        END LOOP;
        BEGIN
            INSERT INTO public.referral_codes (user_id, code) VALUES (p_profile_id, v_code);
            RETURN v_code;
        EXCEPTION WHEN unique_violation THEN
            SELECT code INTO v_code FROM public.referral_codes WHERE user_id = p_profile_id;
            IF v_code IS NOT NULL THEN
                RETURN v_code;
            END IF;
            IF v_attempt >= 10 THEN
                RETURN NULL;
            END IF;
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.storefront_referral_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_referral_code(UUID) TO anon, authenticated, service_role;

-- Existing storefront designs: add the card, switched off.
UPDATE public.profiles p
SET storefront_design = jsonb_set(
        p.storefront_design,
        '{blocks}',
        COALESCE(p.storefront_design->'blocks', '[]'::jsonb) || '[{"type": "referral", "hidden": true}]'::jsonb
    )
WHERE jsonb_array_length(COALESCE(p.storefront_design->'blocks', '[]'::jsonb)) > 0
  AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.storefront_design->'blocks') b WHERE b->>'type' = 'referral'
  );
