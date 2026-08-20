-- Temporary debug RPC to inspect actual storage.objects policies for the
-- form-response-photos bucket. Dropped in a follow-up migration once used.

CREATE OR REPLACE FUNCTION public.debug_list_storage_policies()
RETURNS TABLE(policyname text, cmd text, qual text, with_check text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT polname::text, CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE polcmd::text END,
           pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass;
$$;

GRANT EXECUTE ON FUNCTION public.debug_list_storage_policies() TO anon, authenticated;
