-- Drop the open INSERT policy on baker_specialty_tags.
-- Tags are now a fixed admin-managed list; no user can add new tags.
-- The iOS app no longer calls ensureSpecialtyTags().

DROP POLICY IF EXISTS "Authenticated users can add specialty tags"
  ON public.baker_specialty_tags;
