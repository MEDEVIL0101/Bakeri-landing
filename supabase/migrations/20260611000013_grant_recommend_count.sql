-- Grant recommend_count to anon and authenticated roles.
-- The 20260601000003 migration applied column-level security but omitted
-- recommend_count. PostgREST returns 403 for any SELECT that includes it,
-- silently breaking fetchBakerDirectory and fetchBakerProfile entirely.
GRANT SELECT (recommend_count) ON public.profiles TO anon;
GRANT SELECT (recommend_count) ON public.profiles TO authenticated;
