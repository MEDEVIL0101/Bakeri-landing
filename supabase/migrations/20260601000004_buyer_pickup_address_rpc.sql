-- ==========================================================================
-- get_baker_pickup_info(p_baker_id)
--
-- Lets a confirmed buyer read the baker's street pickup address for their
-- order. Direct SELECT of pickup_address on profiles is restricted to the
-- profile owner only (see 20260601000003_profiles_column_security.sql).
--
-- Access rule: caller must have at least one order with this baker
-- (orders.user_id = p_baker_id AND orders.buyer_profile_id = auth.uid()).
-- Anon callers are rejected outright.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.get_baker_pickup_info(p_baker_id UUID)
RETURNS TABLE (
    pickup_address  TEXT,
    pickup_city     TEXT,
    pickup_province TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT
        p.pickup_address,
        p.pickup_city,
        p.pickup_province
    FROM public.profiles p
    WHERE p.id = p_baker_id
      AND EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.user_id           = p_baker_id
            AND o.buyer_profile_id  = auth.uid()
          LIMIT 1
      )
    LIMIT 1;
$$;

-- Anon cannot call this; only authenticated users with a matching order get a result
REVOKE ALL ON FUNCTION public.get_baker_pickup_info(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_baker_pickup_info(UUID) TO authenticated;
