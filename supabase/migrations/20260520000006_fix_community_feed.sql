-- Fix 1: Add post_type column (was only in a standalone SQL file, never pushed as a migration)
ALTER TABLE public.community_threads
    ADD COLUMN IF NOT EXISTS post_type TEXT NOT NULL DEFAULT 'thread'
        CHECK (post_type IN ('thread', 'image_post'));

UPDATE public.community_threads SET post_type = 'thread' WHERE post_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_threads_post_type
    ON public.community_threads (post_type);

-- Fix 2: Revert SELECT policies from auth-required back to public-read.
-- Migration 20260520000003 tightened these to auth.uid() IS NOT NULL, which breaks
-- guest browsing and causes the feed to silently return empty for unauthenticated sessions.
-- Community content (threads, groups, comments) should be readable by everyone.

DROP POLICY IF EXISTS "groups_select"  ON public.community_groups;
CREATE POLICY "groups_select"
    ON public.community_groups
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "members_select" ON public.community_group_members;
CREATE POLICY "members_select"
    ON public.community_group_members
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "threads_select" ON public.community_threads;
CREATE POLICY "threads_select"
    ON public.community_threads
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "comments_select" ON public.community_comments;
CREATE POLICY "comments_select"
    ON public.community_comments
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "likes_select" ON public.community_likes;
CREATE POLICY "likes_select"
    ON public.community_likes
    FOR SELECT USING (true);
