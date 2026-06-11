-- Drop the SECURITY DEFINER view that was triggering the Supabase CRITICAL warning.
-- community_groups_with_activity is not queried anywhere in the active app;
-- the only caller (fetchPopularGroups) was dead code with zero call sites.
-- The underlying community_groups table is preserved — still used for thread composition.

DROP VIEW IF EXISTS public.community_groups_with_activity;
