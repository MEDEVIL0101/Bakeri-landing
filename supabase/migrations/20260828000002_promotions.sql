-- Promotions — baker-created discounts. PHASE 1: schema + price-resolution
-- functions + storefront display of automatic sales. Checkout enforcement is
-- Phase 2, the iOS creation journey Phase 3, the promo-code field at checkout
-- Phase 4 — but the code columns and resolver support are all here now so
-- those phases are pure wiring.
--
-- Rules (locked 2026-08-28, see PROMOTIONS_PLAN.md):
--   * No stacking — the single biggest discount wins (lowest unit price).
--   * v1 targets: the whole shop (scope='site_wide') or a hand-picked set of
--     listings (scope='listing' + promotion_listings). scope='category' is a
--     valid value + target_categories exists, but nothing resolves it yet.
--   * listing_kind='custom' is NEVER discounted (it is quote-priced).
--   * code IS NULL  -> automatic sale, shows on the storefront.
--     code NOT NULL -> only bites when that code is entered at checkout.
--   * Prices are in the listing's own units (dollars, matching
--     menu_items.default_price / marketplace_price_from). fixed_amount
--     discount_value is dollars; percent is 0-100.

-- ─────────────────────────────── tables ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.promotions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    discount_type          TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed_amount')),
    discount_value         NUMERIC NOT NULL,
    scope                  TEXT NOT NULL CHECK (scope IN ('site_wide', 'listing', 'category')),
    target_categories      TEXT[] NOT NULL DEFAULT '{}',
    starts_at              TIMESTAMPTZ,
    ends_at                TIMESTAMPTZ,
    is_active              BOOLEAN NOT NULL DEFAULT true,
    code                   TEXT,
    code_max_redemptions   INTEGER,
    code_redemption_count  INTEGER NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,

    CONSTRAINT promotions_percent_range
        CHECK (discount_type <> 'percent' OR (discount_value > 0 AND discount_value <= 100)),
    CONSTRAINT promotions_fixed_positive
        CHECK (discount_type <> 'fixed_amount' OR discount_value > 0),
    CONSTRAINT promotions_window_ordered
        CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT promotions_max_redemptions_positive
        CHECK (code_max_redemptions IS NULL OR code_max_redemptions > 0),
    CONSTRAINT promotions_redemption_cap_needs_code
        CHECK (code IS NOT NULL OR code_max_redemptions IS NULL)
);

-- One live code per baker, case-insensitive. Soft-deleted rows are exempt so
-- a retired code can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS promotions_one_code_per_baker
    ON public.promotions (user_id, UPPER(code))
    WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS promotions_user_idx
    ON public.promotions (user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS promotions_active_window_idx
    ON public.promotions (user_id, is_active, starts_at, ends_at)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.promotion_listings (
    promotion_id  UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    menu_item_id  UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS promotion_listings_item_idx
    ON public.promotion_listings (menu_item_id);

-- ─────────────────────────────── RLS ───────────────────────────────
-- Guest read paths all go through the SECURITY DEFINER functions below, so
-- (like baker_links / baker_faqs) there is no public SELECT policy — only
-- the owning baker can touch these rows directly.

ALTER TABLE public.promotions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "baker_manage_own_promotions"
ON public.promotions FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "baker_manage_own_promotion_listings"
ON public.promotion_listings FOR ALL
USING (EXISTS (SELECT 1 FROM public.promotions p
               WHERE p.id = promotion_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.promotions p
                    WHERE p.id = promotion_id AND p.user_id = auth.uid()));

-- ─────────────────────── price-resolution functions ───────────────────────
-- Everything downstream (storefront RPC, checkout edge functions) discounts
-- THROUGH these — the rules live in exactly one place.

-- The single biggest applicable discount for one unit of one listing.
-- p_code NULL => only automatic sales are considered (storefront display).
CREATE OR REPLACE FUNCTION public.effective_unit_price(
    p_user_id       UUID,
    p_listing_kind  TEXT,
    p_menu_item_id  UUID,
    p_unit_price    NUMERIC,
    p_code          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH candidates AS (
        SELECT
            pr.id,
            pr.discount_type,
            pr.discount_value,
            (pr.code IS NOT NULL) AS is_code,
            CASE
                WHEN pr.discount_type = 'percent'
                    THEN GREATEST(0, ROUND(p_unit_price * (100 - pr.discount_value) / 100, 2))
                ELSE GREATEST(0, ROUND(p_unit_price - pr.discount_value, 2))
            END AS cand_price
        FROM public.promotions pr
        WHERE pr.user_id = p_user_id
          AND pr.deleted_at IS NULL
          AND pr.is_active
          AND p_listing_kind IS DISTINCT FROM 'custom'
          AND COALESCE(pr.starts_at, '-infinity'::timestamptz) <= now()
          AND COALESCE(pr.ends_at,   'infinity'::timestamptz)  >  now()
          AND (
                pr.code IS NULL
             OR (p_code IS NOT NULL
                 AND UPPER(pr.code) = UPPER(TRIM(p_code))
                 AND (pr.code_max_redemptions IS NULL
                      OR pr.code_redemption_count < pr.code_max_redemptions))
              )
          AND (
                pr.scope = 'site_wide'
             OR (pr.scope = 'listing' AND EXISTS (
                    SELECT 1 FROM public.promotion_listings pl
                    WHERE pl.promotion_id = pr.id
                      AND pl.menu_item_id = p_menu_item_id))
              )
    )
    SELECT COALESCE(
        (SELECT jsonb_build_object(
             'original_price',  p_unit_price,
             'effective_price', c.cand_price,
             'promotion_id',    c.id,
             'discount_type',   c.discount_type,
             'discount_value',  c.discount_value,
             'is_code',         c.is_code,
             'label',           CASE WHEN c.discount_type = 'percent'
                                     THEN (CASE WHEN c.discount_value = TRUNC(c.discount_value)
                                                THEN TRUNC(c.discount_value)::int::text
                                                ELSE c.discount_value::text END) || '% off'
                                     ELSE '$' || TRIM(TO_CHAR(c.discount_value, 'FM999990.00')) || ' off'
                                END
         )
         FROM candidates c
         ORDER BY c.cand_price ASC, c.is_code DESC
         LIMIT 1),
        jsonb_build_object(
            'original_price',  p_unit_price,
            'effective_price', p_unit_price,
            'promotion_id',    NULL,
            'discount_type',   NULL,
            'discount_value',  NULL,
            'is_code',         false,
            'label',           NULL
        )
    );
$$;

-- Checkout-page preview of a typed code. The finalize path re-checks + counts.
CREATE OR REPLACE FUNCTION public.validate_promo_code(p_baker_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    pr public.promotions%ROWTYPE;
BEGIN
    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('status', 'none');
    END IF;

    SELECT * INTO pr
    FROM public.promotions
    WHERE user_id = p_baker_id
      AND deleted_at IS NULL
      AND code IS NOT NULL
      AND UPPER(code) = UPPER(TRIM(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    IF NOT pr.is_active THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF pr.starts_at IS NOT NULL AND pr.starts_at > now() THEN
        RETURN jsonb_build_object('status', 'not_started', 'starts_at', pr.starts_at);
    END IF;
    IF pr.ends_at IS NOT NULL AND pr.ends_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF pr.code_max_redemptions IS NOT NULL
       AND pr.code_redemption_count >= pr.code_max_redemptions THEN
        RETURN jsonb_build_object('status', 'used_up');
    END IF;

    RETURN jsonb_build_object(
        'status',         'valid',
        'promotion_id',   pr.id,
        'discount_type',  pr.discount_type,
        'discount_value', pr.discount_value,
        'scope',          pr.scope,
        'ends_at',        pr.ends_at,
        'label',          CASE WHEN pr.discount_type = 'percent'
                               THEN (CASE WHEN pr.discount_value = TRUNC(pr.discount_value)
                                          THEN TRUNC(pr.discount_value)::int::text
                                          ELSE pr.discount_value::text END) || '% off'
                               ELSE '$' || TRIM(TO_CHAR(pr.discount_value, 'FM999990.00')) || ' off'
                          END
    );
END;
$$;

-- Authoritative per-line + total pricing for a whole cart. Edge functions
-- build p_items from their already-resolved variant/tier line prices, then
-- charge total_effective. p_items element shape:
--   {"menu_item_id": uuid, "listing_kind": text, "unit_price": numeric, "qty": int}
CREATE OR REPLACE FUNCTION public.resolve_effective_prices(
    p_user_id UUID,
    p_items   JSONB,
    p_code    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    itm           JSONB;
    ep            JSONB;
    v_lines       JSONB := '[]'::jsonb;
    v_total_orig  NUMERIC := 0;
    v_total_eff   NUMERIC := 0;
    v_qty         INTEGER;
    v_unit        NUMERIC;
    v_code_status JSONB;
    v_use_code    TEXT;
BEGIN
    v_code_status := public.validate_promo_code(p_user_id, p_code);
    v_use_code := CASE WHEN v_code_status->>'status' = 'valid' THEN p_code ELSE NULL END;

    FOR itm IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
    LOOP
        v_qty  := GREATEST(0, COALESCE((itm->>'qty')::int, 1));
        v_unit := COALESCE((itm->>'unit_price')::numeric, 0);

        ep := public.effective_unit_price(
            p_user_id,
            itm->>'listing_kind',
            (itm->>'menu_item_id')::uuid,
            v_unit,
            v_use_code
        );

        v_total_orig := v_total_orig + v_unit * v_qty;
        v_total_eff  := v_total_eff  + (ep->>'effective_price')::numeric * v_qty;

        v_lines := v_lines || jsonb_build_object(
            'menu_item_id',         itm->>'menu_item_id',
            'qty',                  v_qty,
            'unit_price',           v_unit,
            'effective_unit_price', (ep->>'effective_price')::numeric,
            'line_original',        ROUND(v_unit * v_qty, 2),
            'line_effective',       ROUND((ep->>'effective_price')::numeric * v_qty, 2),
            'promotion_id',         ep->'promotion_id',
            'label',                ep->'label'
        );
    END LOOP;

    RETURN jsonb_build_object(
        'code_status',       v_code_status->>'status',
        'code_promotion_id', v_code_status->'promotion_id',
        'lines',             v_lines,
        'total_original',    ROUND(v_total_orig, 2),
        'total_effective',   ROUND(v_total_eff, 2),
        'total_discount',    ROUND(v_total_orig - v_total_eff, 2)
    );
END;
$$;

-- Atomic redemption bump for a coded promo, for the finalize path. Returns
-- false if the code hit its cap between checkout and pay.
CREATE OR REPLACE FUNCTION public.redeem_promo_code(p_promotion_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    UPDATE public.promotions
    SET code_redemption_count = code_redemption_count + 1,
        updated_at = now()
    WHERE id = p_promotion_id
      AND code IS NOT NULL
      AND deleted_at IS NULL
      AND (code_max_redemptions IS NULL OR code_redemption_count < code_max_redemptions)
    RETURNING true INTO v_ok;

    RETURN COALESCE(v_ok, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_promo_code(UUID, TEXT)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_unit_price(UUID, TEXT, UUID, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_effective_prices(UUID, JSONB, TEXT)           TO anon, authenticated;

-- ─────────── web-profile RPCs: expose the automatic sale price ───────────
-- Only change vs 20260824000001: each listing row gains sale_price /
-- original_price / promo (null unless an automatic promotion applies). The
-- headline `price` is unchanged. Variant/tier sale prices are derived
-- client-side from `promo`. Custom listings never carry a promo.

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
            shipping_additional_item_percent
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
                      ELSE m.default_price END),
                NULL
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
            shipping_additional_item_percent
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
                      ELSE m.default_price END),
                NULL
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
