-- Bakeri Admin: per-baker GTV summary limited to a date window, so the
-- Analytics "Platform Potential" table and the Command Centre follow the
-- range picker instead of always showing lifetime totals.
-- NULL bounds = unbounded (p_from NULL + p_to NULL = all time).
CREATE OR REPLACE FUNCTION public.admin_platform_summary_range(
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
    baker_user_id UUID,
    order_count   BIGINT,
    total_gtv     NUMERIC,
    paid_gtv      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        o.user_id                                                           AS baker_user_id,
        COUNT(DISTINCT o.id)                                                AS order_count,
        COALESCE(SUM(oi.price_per_unit * oi.quantity), 0)                   AS total_gtv,
        COALESCE(SUM(
            CASE WHEN o.is_paid = true
                 THEN oi.price_per_unit * oi.quantity
                 ELSE 0
            END
        ), 0)                                                               AS paid_gtv
    FROM   orders o
    LEFT   JOIN order_items oi
           ON  oi.order_id   = o.id
           AND oi.deleted_at IS NULL
    WHERE  o.deleted_at IS NULL
      AND  (p_from IS NULL OR o.created_at >= p_from)
      AND  (p_to   IS NULL OR o.created_at <  p_to)
    GROUP  BY o.user_id;
$$;

-- Platform financials: service role (Bakeri Admin) only, like
-- admin_platform_summary in 20261031000002_security_hardening.sql.
REVOKE ALL ON FUNCTION public.admin_platform_summary_range(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_summary_range(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
