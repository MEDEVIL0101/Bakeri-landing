CREATE OR REPLACE FUNCTION public.debug_get_baker_id(p_business_name TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT id FROM profiles WHERE business_name ILIKE p_business_name LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.debug_get_baker_id(TEXT) TO anon, authenticated;
