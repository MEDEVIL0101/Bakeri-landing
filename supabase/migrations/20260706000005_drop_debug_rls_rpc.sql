-- Remove the temporary diagnostic RPC added in
-- 20260706000004_debug_vendor_apps_rls.sql. It confirmed the anon INSERT
-- policy and grants on vendor_applications were correct all along — the
-- earlier RLS error was caused by a manual test using
-- `Prefer: return=representation`, which requires a SELECT policy that
-- this table intentionally doesn't have. The real form never requests
-- representation, so it was never affected.

DROP FUNCTION IF EXISTS public.debug_vendor_applications_rls();
