-- Tighten community table SELECT policies: require authenticated session.
-- Previously used USING (true) which allowed anonymous reads.

-- community_groups
DROP POLICY IF EXISTS "groups_select" ON public.community_groups;
CREATE POLICY "groups_select"
  ON public.community_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- community_group_members
DROP POLICY IF EXISTS "members_select" ON public.community_group_members;
CREATE POLICY "members_select"
  ON public.community_group_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- community_threads
DROP POLICY IF EXISTS "threads_select" ON public.community_threads;
CREATE POLICY "threads_select"
  ON public.community_threads
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- community_comments
DROP POLICY IF EXISTS "comments_select" ON public.community_comments;
CREATE POLICY "comments_select"
  ON public.community_comments
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- community_likes
DROP POLICY IF EXISTS "likes_select" ON public.community_likes;
CREATE POLICY "likes_select"
  ON public.community_likes
  FOR SELECT USING (auth.uid() IS NOT NULL);
