-- Storefront "link in bio" builder — Phase A.
-- Adds: a fourth menu_items.listing_kind ('digital', for sellable
-- know-how/PDFs/courses — reuses the whole existing menu_items/Stripe
-- Connect/payout pipeline instead of a parallel commerce system), a new
-- baker_links table for plain external links (Amazon, social, anything not
-- sellable — copied from baker_faqs's exact shape/RLS pattern), a public
-- storage bucket for the storefront header image, a private bucket for
-- digital product files, and a v_links field on the public web-profile RPCs.

-- MARK: menu_items — widen listing_kind + digital file path

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_listing_kind_check;
ALTER TABLE public.menu_items
    ADD CONSTRAINT menu_items_listing_kind_check
    CHECK (listing_kind IN ('ready_now', 'preorder', 'custom', 'digital'));

-- Never exposed via the public web-profile RPC — only read server-side by
-- finalize-guest-digital-order, so a buyer can't guess/hit the file path
-- directly. Digital items also skip pickup/weight/tax-category concepts
-- entirely (tax forced to $0 for listing_kind = 'digital' elsewhere).
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS digital_file_path TEXT;

-- MARK: baker_links — plain external links (Amazon affiliate, social, etc.)
-- Read only via the web-profile RPCs (SECURITY DEFINER, bypasses RLS) — no
-- public SELECT policy needed, same treatment as baker_faqs.

CREATE TABLE IF NOT EXISTS public.baker_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    section     TEXT NOT NULL,
    label       TEXT NOT NULL,
    url         TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS baker_links_user_idx ON public.baker_links (user_id, sort_order);

ALTER TABLE public.baker_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "baker_manage_own_links"
ON public.baker_links FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- MARK: Storage — header image (public) + digital product files (private)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'storefront-headers',
  'storefront-headers',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "baker_manage_own_header"
ON storage.objects FOR ALL
USING (
  bucket_id = 'storefront-headers'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'storefront-headers'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Private — deliberately no anon/authenticated SELECT policy at all. Only
-- ever read via a service-role createSignedUrl() call from
-- finalize-guest-digital-order, so RLS default-deny is correct and
-- sufficient. Bakers still need to upload/manage their own files though.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('digital-products', 'digital-products', false, 104857600)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "baker_manage_own_digital_products"
ON storage.objects FOR ALL
USING (
  bucket_id = 'digital-products'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'digital-products'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- MARK: web-profile RPCs — add v_links, purely additive

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
