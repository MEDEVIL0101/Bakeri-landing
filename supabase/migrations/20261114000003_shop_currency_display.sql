-- Shop currency on storefronts (Harvey 2026-11-14). Shops charge in their
-- vendor's own currency (US -> USD, everyone else -> CAD; _shared/currency.ts),
-- but pages only ever said "$". Storefronts and payment pages now label the
-- currency, and shoppers can view approximate prices in the other currency
-- (CAD <-> USD) — display only, the charge is still in the shop's currency.
--   fx_rates            daily ECB rates (refresh-fx-rates, cron below)
--   storefront_currency {currency, alt_currency, rate, as_of} for a shop (public)
--   get_baker_web_profile_by_slug/_by_id now include country + money.

CREATE TABLE IF NOT EXISTS public.fx_rates (
    base       TEXT NOT NULL,
    quote      TEXT NOT NULL,
    rate       NUMERIC(14, 6) NOT NULL CHECK (rate > 0),
    as_of      DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (base, quote)
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fx_rates FROM anon, authenticated;
GRANT ALL ON public.fx_rates TO service_role;

INSERT INTO public.fx_rates (base, quote, rate, as_of) VALUES
    ('cad', 'usd', 0.70136, '2026-11-13'),
    ('usd', 'cad', round(1 / 0.70136, 6), '2026-11-13')
ON CONFLICT (base, quote) DO NOTHING;

CREATE OR REPLACE FUNCTION public.storefront_currency(p_baker_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT CASE WHEN upper(coalesce(country, '')) = 'US' THEN 'usd' ELSE 'cad' END AS cur
    FROM profiles WHERE id = p_baker_id
  )
  SELECT jsonb_build_object(
    'currency', c.cur,
    'alt_currency', CASE WHEN c.cur = 'usd' THEN 'cad' ELSE 'usd' END,
    'rate', f.rate,
    'as_of', f.as_of)
  FROM c LEFT JOIN fx_rates f ON f.base = c.cur AND f.quote = CASE WHEN c.cur = 'usd' THEN 'cad' ELSE 'usd' END;
$$;
REVOKE ALL ON FUNCTION public.storefront_currency(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_currency(UUID) TO anon, authenticated, service_role;

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
            country, public.storefront_currency(id) AS money,
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
            country, public.storefront_currency(id) AS money,
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

-- Daily after the ECB publishes (~16:00 CET).
SELECT cron.unschedule('refresh-fx-rates') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-fx-rates');
SELECT cron.schedule('refresh-fx-rates', '30 16 * * *', $cron$
    select net.http_post(
        url := 'https://aqhebjxaynvtvurwedrl.supabase.co/functions/v1/refresh-fx-rates',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bakeri_webhook_secret' limit 1)
        ),
        body := '{}'::jsonb
    );
$cron$);
