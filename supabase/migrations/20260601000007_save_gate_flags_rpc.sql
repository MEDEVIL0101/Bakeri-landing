-- save_my_gate_flags RPC
--
-- The profiles column-level security migration (20260601000003) revoked SELECT
-- on internal columns (marketplace_onboarded, baker_type, etc.) from the
-- authenticated role. PostgREST's UPDATE returns RETURNING * by default, which
-- fails when the role lacks SELECT on some columns.
--
-- This SECURITY DEFINER RPC performs the update under the definer's privileges,
-- enforcing that callers can only update their OWN row via auth.uid().

CREATE OR REPLACE FUNCTION public.save_my_gate_flags(
    p_marketplace_onboarded BOOLEAN  DEFAULT NULL,
    p_baker_type            TEXT     DEFAULT NULL,
    p_delivery_gate_accepted BOOLEAN DEFAULT NULL,
    p_deposits_gate_accepted BOOLEAN DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.profiles
    SET
        marketplace_onboarded  = COALESCE(p_marketplace_onboarded,  marketplace_onboarded),
        baker_type             = COALESCE(p_baker_type,             baker_type),
        delivery_gate_accepted = COALESCE(p_delivery_gate_accepted, delivery_gate_accepted),
        deposits_gate_accepted = COALESCE(p_deposits_gate_accepted, deposits_gate_accepted),
        updated_at             = NOW()
    WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_gate_flags(BOOLEAN, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_my_gate_flags(BOOLEAN, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
