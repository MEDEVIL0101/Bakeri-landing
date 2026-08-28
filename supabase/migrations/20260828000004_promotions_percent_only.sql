-- v1 scope decision (2026-08-28): promotions are PERCENT-OFF ONLY.
--
-- fixed_amount stays a legal discount_type value in the schema for a later
-- phase, but applied per-unit it lets a "$10 off" code zero a $5 item, and a
-- fixed-dollar code almost always means "$X off the order", not per unit —
-- which needs order-level plumbing the storefront/checkout don't have yet.
-- So the resolver simply ignores any non-'percent' promotion for now, and a
-- fixed_amount code reads as invalid. Re-enabling fixed later = widening
-- these two WHERE clauses + adding the order-level path.
--
-- Only the candidate filters change vs 20260828000002; bodies otherwise
-- identical.

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
          AND pr.discount_type = 'percent'          -- v1: percent-off only
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
      AND discount_type = 'percent'          -- v1: percent-off only
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
        'label',          (CASE WHEN pr.discount_value = TRUNC(pr.discount_value)
                                THEN TRUNC(pr.discount_value)::int::text
                                ELSE pr.discount_value::text END) || '% off'
    );
END;
$$;
