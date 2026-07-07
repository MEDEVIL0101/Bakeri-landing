-- Temporary diagnostic RPC to inspect why anon INSERT into vendor_applications
-- is failing RLS despite a WITH CHECK (true) policy and an explicit GRANT.
-- Safe to drop once the real issue is identified — read-only introspection,
-- no application data exposed.

CREATE OR REPLACE FUNCTION public.debug_vendor_applications_rls()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'policies', (
      SELECT jsonb_agg(jsonb_build_object(
        'policyname', policyname,
        'permissive', permissive,
        'roles', roles,
        'cmd', cmd,
        'qual', qual,
        'with_check', with_check
      ))
      FROM pg_policies
      WHERE tablename = 'vendor_applications'
    ),
    'grants', (
      SELECT jsonb_agg(jsonb_build_object(
        'grantee', grantee,
        'privilege_type', privilege_type
      ))
      FROM information_schema.role_table_grants
      WHERE table_name = 'vendor_applications'
    ),
    'rls_enabled', (
      SELECT relrowsecurity FROM pg_class WHERE relname = 'vendor_applications'
    ),
    'rls_forced', (
      SELECT relforcerowsecurity FROM pg_class WHERE relname = 'vendor_applications'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.debug_vendor_applications_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_vendor_applications_rls() TO anon, authenticated;
