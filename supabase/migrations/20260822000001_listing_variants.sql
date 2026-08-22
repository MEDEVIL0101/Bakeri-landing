-- ============================================================
-- Listing variants — a general-goods (digital/physical) listing can offer
-- several purchasable options (e.g. Small/Medium/Large/XL on a cookie-
-- cutter-set listing), each with its own price and, for physical, its own
-- stock count. Distinct from Assorted Box's size-tier + flavor-mix system
-- (menu_item_size_tiers/menu_item_variants) — a buyer here picks exactly
-- one option, no flavor mix to fill, so this is a new, simpler table
-- rather than a rename/reuse of the box tables.
--
-- This migration also restores is_assorted_box/size_tiers/variants to the
-- two web-profile RPCs — 20260821000001_physical_shipping_fee.sql
-- accidentally dropped them when it added shipping_fee (regression: any
-- Assorted Box listing's size tiers/variants have not shown on the public
-- storefront since that migration). Restored here alongside the new
-- listing_variants fields, all purely additive.
-- ============================================================

-- MARK: menu_items — variants flag

ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT false;

-- MARK: listing_variants

CREATE TABLE IF NOT EXISTS public.listing_variants (
    id           uuid primary key,
    user_id      uuid references auth.users on delete cascade not null,
    menu_item_id uuid references public.menu_items on delete cascade not null,
    label        text not null default '',
    price        double precision not null default 0,
    -- Only meaningful for physical listings — a digital listing's variant
    -- is always available regardless of this value (no file copy to run out of).
    stock_qty    int  not null default 0,
    sort_order   int  not null default 0,
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS listing_variants_item_idx ON public.listing_variants (menu_item_id, sort_order);

ALTER TABLE public.listing_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own listing variants"
ON public.listing_variants FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "marketplace_listing_variants_public_read"
ON public.listing_variants FOR SELECT
USING (
    deleted_at IS NULL
    AND menu_item_id IN (
        SELECT id FROM public.menu_items
        WHERE is_listed_in_marketplace = true
          AND is_active = true
    )
);

-- MARK: order_items — server-written snapshot of the buyer's variant pick

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_label text;

-- MARK: web-profile RPCs — restore is_assorted_box/size_tiers/variants
-- (regression fix) and add has_variants/listing_variants (new feature)

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
            stripe_connect_onboarding_complete,
            shipping_free_over_threshold
        FROM public.profiles
        WHERE id = v_user_id
    ) p;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            m.id,
            m.name,
            m.item_description,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
            m.lead_days,
            m.shipping_fee,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            m.available_qty_today,
            m.unit,
            m.intake_form_id,
            m.use_drop_date,
            m.preorder_drop_date,
            m.max_preorder_quantity,
            m.tax_category,
            m.unit_weight_grams,
            m.is_assorted_box,
            m.has_variants,
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        WHERE m.user_id = v_user_id
          AND m.is_listed_in_marketplace = true
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
            stripe_connect_onboarding_complete,
            shipping_free_over_threshold
        FROM public.profiles
        WHERE id = p_user_id
    ) p;

    IF v_profile IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT json_agg(l ORDER BY l.listing_kind, l.name) INTO v_listings
    FROM (
        SELECT
            m.id,
            m.name,
            m.item_description,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
            m.lead_days,
            m.shipping_fee,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            m.available_qty_today,
            m.unit,
            m.intake_form_id,
            m.use_drop_date,
            m.preorder_drop_date,
            m.max_preorder_quantity,
            m.tax_category,
            m.unit_weight_grams,
            m.is_assorted_box,
            m.has_variants,
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        WHERE m.user_id = p_user_id
          AND m.is_listed_in_marketplace = true
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
