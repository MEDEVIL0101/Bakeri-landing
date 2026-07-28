-- ============================================================
-- Storefront v2: new fields for the redesigned public storefront
-- (about story + portrait, neighbourhood, structured weekly pickup
-- hours, baker FAQ entries, per-item allergens/lead-time). All
-- public-facing but non-sensitive — same treatment as bio/store_policies,
-- exposed only through the web-profile RPCs, not raw anon grants.
-- ============================================================

-- MARK: profiles — about band + neighbourhood + structured hours

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS about_story        TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS neighbourhood      TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pickup_hours_json  JSONB NOT NULL DEFAULT '{}'::jsonb;

GRANT SELECT (about_story, neighbourhood, pickup_hours_json)
    ON public.profiles TO anon;
GRANT SELECT (about_story, neighbourhood, pickup_hours_json)
    ON public.profiles TO authenticated;

-- These have had working editors in StorefrontSettingsSheet for a while but
-- were never actually persisted server-side (no backing column existed) —
-- edits silently stayed local-only. Adding the columns here so the app-side
-- sync fix has somewhere to write to. Delivery is currently paused
-- app-wide, so these stay off the public RPCs for now, same as
-- pickup_address — nothing here is exposed until delivery ships.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS pickup_note        TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS delivery_enabled   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS delivery_fee       DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    ADD COLUMN IF NOT EXISTS delivery_radius    INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS delivery_free_over DOUBLE PRECISION NOT NULL DEFAULT 0;

-- MARK: menu_items — per-item allergens + lead-time copy

ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS allergens       TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS lead_time_note  TEXT NOT NULL DEFAULT '';

-- MARK: baker_faqs — repeatable Q&A entries for the storefront's
-- "Good to know" accordion. Read only via the web-profile RPCs
-- (SECURITY DEFINER, bypasses RLS) — no public SELECT policy needed.

CREATE TABLE IF NOT EXISTS public.baker_faqs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS baker_faqs_user_idx ON public.baker_faqs (user_id, sort_order);

ALTER TABLE public.baker_faqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "baker_manage_own_faqs"
ON public.baker_faqs FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- MARK: Storage — baker portrait photo for the About band.
-- Same shape as business-logos: path {baker_id}/portrait.jpg, public bucket
-- so the storefront can load it without auth overhead.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'baker-portraits',
  'baker-portraits',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "baker_manage_own_portrait"
ON storage.objects FOR ALL
USING (
  bucket_id = 'baker-portraits'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'baker-portraits'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- MARK: web-profile RPCs — expose the new fields

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
        SELECT id, question, answer
        FROM public.baker_faqs
        WHERE user_id = v_user_id
          AND deleted_at IS NULL
    ) f;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json)
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
        SELECT id, question, answer
        FROM public.baker_faqs
        WHERE user_id = p_user_id
          AND deleted_at IS NULL
    ) f;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json)
    );
END;
$$;
