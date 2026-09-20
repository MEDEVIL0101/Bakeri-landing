-- Storefront block layout — lets a baker reorder and hide the content
-- sections of her public storefront (baker/index.html) instead of the
-- section order being permanently hardcoded.
--
-- profiles.storefront_block_layout is an ordered JSON array of
-- {"type": <block type>, "hidden": <bool>}. The default below is a literal
-- copy of today's hardcoded render order, every block visible — so this
-- migration backfills every existing baker's row with an array that
-- reproduces her site's current live order exactly. Nothing changes for
-- any existing storefront until a baker actively opens the new iOS builder
-- and touches it.
--
-- Hero (photo/logo/name/bio/social) and the footer are intentionally NOT
-- part of this array — they stay pinned first/last on both the iOS builder
-- and the web renderer, never reorderable, so a baker can't accidentally
-- bury her own identity block.
--
-- Both get_baker_web_profile_by_* bodies below are otherwise byte-identical
-- to 20260910000001 — the only change is `storefront_block_layout` added to
-- the v_profile subquery (same expression in both functions).

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS storefront_block_layout JSONB
    NOT NULL DEFAULT '[
        {"type":"menu","hidden":false},
        {"type":"digital","hidden":false},
        {"type":"physical","hidden":false},
        {"type":"links","hidden":false},
        {"type":"about","hidden":false},
        {"type":"faq","hidden":false},
        {"type":"policies","hidden":false},
        {"type":"hours","hidden":false}
    ]'::jsonb;

COMMENT ON COLUMN public.profiles.storefront_block_layout IS
    'Ordered array of {"type","hidden"} controlling which storefront content blocks show and in what order. Default reproduces the pre-block-builder hardcoded render order. Hero and footer are not represented here — always pinned first/last.';

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
            id, user_name, business_name, profile_slug, bio, store_policies,
            about_story, neighbourhood, pickup_hours_json, specialty_tags,
            location, pickup_city, pickup_province, follower_count,
            selected_theme, background_pattern, is_gst_registered,
            stripe_connect_onboarding_complete, shipping_free_over_threshold,
            shipping_additional_item_percent, updated_at, storefront_listing_id,
            storefront_block_layout,
            (SELECT pr.banner_text FROM public.promotions pr
             WHERE pr.user_id = public.profiles.id AND pr.deleted_at IS NULL AND pr.is_active
               AND pr.banner_text IS NOT NULL AND btrim(pr.banner_text) <> ''
               AND COALESCE(pr.starts_at, '-infinity'::timestamptz) <= now()
               AND COALESCE(pr.ends_at,   'infinity'::timestamptz)  >  now()
             ORDER BY pr.created_at DESC LIMIT 1) AS promo_banner
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
            m.shipping_always_full_price,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            (promo.ep->>'effective_price')::numeric AS sale_price,
            (promo.ep->>'original_price')::numeric  AS original_price,
            CASE WHEN promo.ep->>'promotion_id' IS NOT NULL
                 THEN jsonb_build_object(
                          'discount_type',  promo.ep->>'discount_type',
                          'discount_value', (promo.ep->>'discount_value')::numeric,
                          'label',          promo.ep->>'label')
                 ELSE NULL
            END AS promo,
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
                SELECT id, label, unit_count, price, sort_order
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image, sort_order
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty, has_image, sort_order
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        LEFT JOIN LATERAL (
            SELECT public.effective_unit_price(
                m.user_id, m.listing_kind, m.id,
                (CASE WHEN m.marketplace_price_from > 0
                      THEN m.marketplace_price_from
                      ELSE m.default_price END)::numeric,
                NULL::text
            ) AS ep
        ) promo ON true
        WHERE m.user_id = v_user_id
          AND m.is_listed_in_marketplace = true
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = v_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT id, section, label, url, sort_order
        FROM public.baker_links
        WHERE user_id = v_user_id AND deleted_at IS NULL
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
            id, user_name, business_name, profile_slug, bio, store_policies,
            about_story, neighbourhood, pickup_hours_json, specialty_tags,
            location, pickup_city, pickup_province, follower_count,
            selected_theme, background_pattern, is_gst_registered,
            stripe_connect_onboarding_complete, shipping_free_over_threshold,
            shipping_additional_item_percent, updated_at, storefront_listing_id,
            storefront_block_layout,
            (SELECT pr.banner_text FROM public.promotions pr
             WHERE pr.user_id = public.profiles.id AND pr.deleted_at IS NULL AND pr.is_active
               AND pr.banner_text IS NOT NULL AND btrim(pr.banner_text) <> ''
               AND COALESCE(pr.starts_at, '-infinity'::timestamptz) <= now()
               AND COALESCE(pr.ends_at,   'infinity'::timestamptz)  >  now()
             ORDER BY pr.created_at DESC LIMIT 1) AS promo_banner
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
            m.shipping_always_full_price,
            CASE WHEN m.marketplace_price_from > 0
                 THEN m.marketplace_price_from
                 ELSE m.default_price
            END AS price,
            (promo.ep->>'effective_price')::numeric AS sale_price,
            (promo.ep->>'original_price')::numeric  AS original_price,
            CASE WHEN promo.ep->>'promotion_id' IS NOT NULL
                 THEN jsonb_build_object(
                          'discount_type',  promo.ep->>'discount_type',
                          'discount_value', (promo.ep->>'discount_value')::numeric,
                          'label',          promo.ep->>'label')
                 ELSE NULL
            END AS promo,
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
                SELECT id, label, unit_count, price, sort_order
                FROM public.menu_item_size_tiers
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) t) AS size_tiers,
            (SELECT json_agg(v ORDER BY v.sort_order) FROM (
                SELECT id, name, has_image, sort_order
                FROM public.menu_item_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) v) AS variants,
            (SELECT json_agg(o ORDER BY o.sort_order) FROM (
                SELECT id, label, price, stock_qty, has_image, sort_order
                FROM public.listing_variants
                WHERE menu_item_id = m.id AND deleted_at IS NULL
            ) o) AS listing_variants
        FROM public.menu_items m
        LEFT JOIN LATERAL (
            SELECT public.effective_unit_price(
                m.user_id, m.listing_kind, m.id,
                (CASE WHEN m.marketplace_price_from > 0
                      THEN m.marketplace_price_from
                      ELSE m.default_price END)::numeric,
                NULL::text
            ) AS ep
        ) promo ON true
        WHERE m.user_id = p_user_id
          AND m.is_listed_in_marketplace = true
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = p_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT id, section, label, url, sort_order
        FROM public.baker_links
        WHERE user_id = p_user_id AND deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$$;
