-- Pre-sales (Harvey 2026-11-10, for Cookiesbysteph): any physical or digital
-- listing, course or club can be sold before it's out.
--   presale_release_at — ships / arrives / opens on this date. A pre-sale while
--                        it's in the future; afterwards a normal listing again.
--   presale_order_by   — optional "Pre-order by" date; checkout closes after it.
--   sell_limit / sold_count — optional "only N" for digital, courses and clubs
--                        (physical keeps its stock count). Claimed atomically at
--                        finalize by claim_sell_limit_batch.
-- order_items.presale_release_at marks a digital line whose download is held
-- until release; release-presales (hourly cron) sends it and sets
-- presale_delivered_at. Physical pre-sale orders take the release date as
-- their due date so they land on the schedule that day.

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS presale_release_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presale_order_by   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sell_limit         INT CHECK (sell_limit IS NULL OR sell_limit >= 0),
  ADD COLUMN IF NOT EXISTS sold_count         INT NOT NULL DEFAULT 0;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS presale_release_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presale_delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS order_items_presale_pending_idx
  ON public.order_items (presale_release_at)
  WHERE presale_release_at IS NOT NULL AND presale_delivered_at IS NULL;

-- All-or-nothing: counts every line toward its listing's sold_count, refusing
-- the whole batch if any limited listing would go past its limit.
-- p_items: [{"id": "<menu_item_id>", "qty": 1}, ...]
CREATE OR REPLACE FUNCTION public.claim_sell_limit_batch(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec JSONB;
BEGIN
    FOR rec IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        UPDATE public.menu_items
        SET sold_count = sold_count + (rec->>'qty')::INTEGER
        WHERE id = (rec->>'id')::UUID
          AND (sell_limit IS NULL OR sold_count + (rec->>'qty')::INTEGER <= sell_limit);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'sell_limit_reached:%', rec->>'id';
        END IF;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_sell_limit_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sell_limit_batch(JSONB) TO service_role;

-- Storefront feeds: the pre-sale dates and how many are left (never the raw count).

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_id(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            storefront_block_layout, storefront_design, tips_enabled,
            email_capture_heading, email_capture_body, email_capture_display_style,
            email_capture_deliverable_listing_id, header_signup_enabled, header_signup_label,
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
            m.content_blocks,
            m.is_course,
            m.addon_offer,
            m.is_club,
            m.club_interval,
            m.presale_order_by,
            m.presale_release_at,
            m.sell_limit,
            CASE WHEN m.sell_limit IS NULL THEN NULL ELSE GREATEST(m.sell_limit - m.sold_count, 0) END AS sell_left,
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
            m.storefront_intro_title,
            m.storefront_intro_body,
            m.is_storefront_form,
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
          AND m.deleted_at IS NULL
          AND (
              auth.uid() = m.user_id
              -- A custom-order request takes no payment (quotes are paid
              -- later, and sending one needs Direct Deposit), so request
              -- forms show without Stripe connected.
              OR m.listing_kind = 'custom'
              OR EXISTS (
                  SELECT 1 FROM public.profiles sp
                  WHERE sp.id = m.user_id
                    AND (
                        sp.stripe_connect_onboarding_complete
                        OR sp.vendor_setup_completed_at IS NULL
                        OR sp.vendor_setup_completed_at <= '2026-09-23 00:00:00+00'
                    )
              )
          )
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = p_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT bl.id, bl.section, bl.label, bl.url, bl.sort_order,
               bl.style, bl.image_url, bl.outline_style, bl.shake,
               bl.target_type, bl.linked_listing_id,
               bl.subtitle, bl.button_label,
               tgt.name AS target_listing_name,
               tgt.is_lead_magnet AS target_listing_is_lead_magnet,
               tgt.item_description AS target_listing_description
        FROM public.baker_links bl
        LEFT JOIN public.menu_items tgt
               ON tgt.id = bl.linked_listing_id AND tgt.user_id = p_user_id
        WHERE bl.user_id = p_user_id AND bl.deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_baker_web_profile_by_slug(p_slug text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            storefront_block_layout, storefront_design, tips_enabled,
            email_capture_heading, email_capture_body, email_capture_display_style,
            email_capture_deliverable_listing_id, header_signup_enabled, header_signup_label,
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
            m.content_blocks,
            m.is_course,
            m.addon_offer,
            m.is_club,
            m.club_interval,
            m.presale_order_by,
            m.presale_release_at,
            m.sell_limit,
            CASE WHEN m.sell_limit IS NULL THEN NULL ELSE GREATEST(m.sell_limit - m.sold_count, 0) END AS sell_left,
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
            m.storefront_intro_title,
            m.storefront_intro_body,
            m.is_storefront_form,
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
          AND m.deleted_at IS NULL
          AND (
              auth.uid() = m.user_id
              -- A custom-order request takes no payment (quotes are paid
              -- later, and sending one needs Direct Deposit), so request
              -- forms show without Stripe connected.
              OR m.listing_kind = 'custom'
              OR EXISTS (
                  SELECT 1 FROM public.profiles sp
                  WHERE sp.id = m.user_id
                    AND (
                        sp.stripe_connect_onboarding_complete
                        OR sp.vendor_setup_completed_at IS NULL
                        OR sp.vendor_setup_completed_at <= '2026-09-23 00:00:00+00'
                    )
              )
          )
    ) l;

    SELECT json_agg(f ORDER BY f.sort_order) INTO v_faqs
    FROM (
        SELECT id, question, answer, sort_order
        FROM public.baker_faqs
        WHERE user_id = v_user_id AND deleted_at IS NULL
    ) f;

    SELECT json_agg(k ORDER BY k.sort_order) INTO v_links
    FROM (
        SELECT bl.id, bl.section, bl.label, bl.url, bl.sort_order,
               bl.style, bl.image_url, bl.outline_style, bl.shake,
               bl.target_type, bl.linked_listing_id,
               bl.subtitle, bl.button_label,
               tgt.name AS target_listing_name,
               tgt.is_lead_magnet AS target_listing_is_lead_magnet,
               tgt.item_description AS target_listing_description
        FROM public.baker_links bl
        LEFT JOIN public.menu_items tgt
               ON tgt.id = bl.linked_listing_id AND tgt.user_id = v_user_id
        WHERE bl.user_id = v_user_id AND bl.deleted_at IS NULL
    ) k;

    RETURN json_build_object(
        'profile',  v_profile,
        'listings', COALESCE(v_listings, '[]'::json),
        'faqs',     COALESCE(v_faqs, '[]'::json),
        'links',    COALESCE(v_links, '[]'::json)
    );
END;
$function$;

-- Opening-day email for course / club members who joined without an order
-- (club subscriptions, students added by hand): release-presales sends their
-- link once per release date and records which date it announced, so moving
-- the date re-arms it.
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS presale_announced_for TIMESTAMPTZ;

-- Hourly: send pre-sale downloads / course links whose release date has passed.
SELECT cron.schedule('release-presales', '7 * * * *', $cron$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/release-presales',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
$cron$);
