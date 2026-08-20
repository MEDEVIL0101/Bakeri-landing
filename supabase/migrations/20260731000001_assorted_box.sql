-- ============================================================
-- Assorted Box product type
-- A listing can offer several size tiers (e.g. Box of 4/6/12, each its own
-- price) and a list of flavor/variant options with thumbnails. The buyer
-- picks a tier, then fills a flavor mix up to that tier's unit count.
-- ============================================================

-- MARK: menu_items — box flag

ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS is_assorted_box BOOLEAN NOT NULL DEFAULT false;

-- MARK: menu_item_size_tiers

CREATE TABLE IF NOT EXISTS public.menu_item_size_tiers (
    id           uuid primary key,
    user_id      uuid references auth.users on delete cascade not null,
    menu_item_id uuid references public.menu_items on delete cascade not null,
    label        text not null default '',
    unit_count   int  not null default 1,
    price        double precision not null default 0,
    sort_order   int  not null default 0,
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS menu_item_size_tiers_item_idx ON public.menu_item_size_tiers (menu_item_id, sort_order);

ALTER TABLE public.menu_item_size_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own size tiers"
ON public.menu_item_size_tiers FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Mirrors marketplace_items_public_read / intake_form_fields' public-read
-- shape: readable once the parent listing is a live marketplace listing.
CREATE POLICY "marketplace_size_tiers_public_read"
ON public.menu_item_size_tiers FOR SELECT
USING (
    deleted_at IS NULL
    AND menu_item_id IN (
        SELECT id FROM public.menu_items
        WHERE is_listed_in_marketplace = true
          AND is_active = true
    )
);

-- MARK: menu_item_variants

CREATE TABLE IF NOT EXISTS public.menu_item_variants (
    id           uuid primary key,
    user_id      uuid references auth.users on delete cascade not null,
    menu_item_id uuid references public.menu_items on delete cascade not null,
    name         text not null default '',
    sort_order   int  not null default 0,
    has_image    boolean not null default false,
    updated_at   timestamptz not null default now(),
    deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS menu_item_variants_item_idx ON public.menu_item_variants (menu_item_id, sort_order);

ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own variants"
ON public.menu_item_variants FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "marketplace_variants_public_read"
ON public.menu_item_variants FOR SELECT
USING (
    deleted_at IS NULL
    AND menu_item_id IN (
        SELECT id FROM public.menu_items
        WHERE is_listed_in_marketplace = true
          AND is_active = true
    )
);

-- MARK: order_items — server-written snapshot of the buyer's flavor picks

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_breakdown jsonb;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tier_label text;

-- MARK: web-profile RPCs — add is_assorted_box + size_tiers + variants, purely additive

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
            m.id,
            m.name,
            m.item_description,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
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
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants
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
            m.id,
            m.name,
            m.item_description,
            m.category,
            m.listing_kind,
            m.allergens,
            m.lead_time_note,
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
            (SELECT json_agg(t ORDER BY t.sort_order) FROM (
                SELECT id, label, unit_count, price
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants
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
