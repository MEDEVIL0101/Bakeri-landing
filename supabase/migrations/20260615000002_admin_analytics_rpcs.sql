-- Admin analytics: per-baker all-time GTV summary (platform potential revenue view)
CREATE OR REPLACE FUNCTION admin_platform_summary()
RETURNS TABLE(
    baker_user_id UUID,
    order_count   BIGINT,
    total_gtv     NUMERIC,
    paid_gtv      NUMERIC
)
LANGUAGE sql
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
    GROUP  BY o.user_id;
$$;

-- Admin analytics: per-day order count + GTV for the last N days
CREATE OR REPLACE FUNCTION admin_daily_order_metrics(p_days INT DEFAULT 30)
RETURNS TABLE(
    day         DATE,
    order_count BIGINT,
    daily_gtv   NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        DATE(o.created_at AT TIME ZONE 'UTC')             AS day,
        COUNT(DISTINCT o.id)                               AS order_count,
        COALESCE(SUM(oi.price_per_unit * oi.quantity), 0) AS daily_gtv
    FROM   orders o
    LEFT   JOIN order_items oi
           ON  oi.order_id   = o.id
           AND oi.deleted_at IS NULL
    WHERE  o.deleted_at IS NULL
      AND  o.created_at >= (NOW() AT TIME ZONE 'UTC') - (p_days || ' days')::INTERVAL
    GROUP  BY DATE(o.created_at AT TIME ZONE 'UTC')
    ORDER  BY day;
$$;
