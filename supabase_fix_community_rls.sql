-- Fix community feed visibility
-- The SELECT policy on community tables was scoped to author_id = auth.uid(),
-- which caused the feed to only show the current user's own posts.
-- Community content should be readable by everyone (authenticated + guests).

-- ── community_threads ────────────────────────────────────────────────────────

-- Drop any existing SELECT policies that restrict by author
DROP POLICY IF EXISTS "Users manage own threads"    ON public.community_threads;
DROP POLICY IF EXISTS "Users can read own threads"  ON public.community_threads;
DROP POLICY IF EXISTS "Authors manage own threads"  ON public.community_threads;
DROP POLICY IF EXISTS "community_threads_select"    ON public.community_threads;

-- Allow anyone (authenticated + anon/guest) to read all threads
CREATE POLICY "Anyone can read community threads"
    ON public.community_threads
    FOR SELECT
    USING (true);

-- Authors can insert their own threads
DROP POLICY IF EXISTS "Users can insert threads"    ON public.community_threads;
DROP POLICY IF EXISTS "community_threads_insert"    ON public.community_threads;

CREATE POLICY "Authenticated users can post threads"
    ON public.community_threads
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND author_id = auth.uid()::text);

-- Authors can update/delete their own threads
DROP POLICY IF EXISTS "Users can update own threads" ON public.community_threads;
DROP POLICY IF EXISTS "Users can delete own threads" ON public.community_threads;

CREATE POLICY "Authors can update own threads"
    ON public.community_threads
    FOR UPDATE
    USING (author_id = auth.uid()::text);

CREATE POLICY "Authors can delete own threads"
    ON public.community_threads
    FOR DELETE
    USING (author_id = auth.uid()::text);

-- ── community_thread_photos ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own thread photos"   ON public.community_thread_photos;
DROP POLICY IF EXISTS "Users can read own thread photos" ON public.community_thread_photos;
DROP POLICY IF EXISTS "community_thread_photos_select"   ON public.community_thread_photos;

CREATE POLICY "Anyone can read thread photos"
    ON public.community_thread_photos
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "community_thread_photos_insert" ON public.community_thread_photos;

CREATE POLICY "Authenticated users can insert thread photos"
    ON public.community_thread_photos
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- ── community_replies ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own replies"    ON public.community_replies;
DROP POLICY IF EXISTS "Users can read own replies"  ON public.community_replies;
DROP POLICY IF EXISTS "community_replies_select"    ON public.community_replies;

CREATE POLICY "Anyone can read community replies"
    ON public.community_replies
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can insert replies"   ON public.community_replies;
DROP POLICY IF EXISTS "community_replies_insert"   ON public.community_replies;

CREATE POLICY "Authenticated users can post replies"
    ON public.community_replies
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND author_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own replies" ON public.community_replies;
DROP POLICY IF EXISTS "Users can delete own replies" ON public.community_replies;

CREATE POLICY "Authors can update own replies"
    ON public.community_replies
    FOR UPDATE
    USING (author_id = auth.uid()::text);

CREATE POLICY "Authors can delete own replies"
    ON public.community_replies
    FOR DELETE
    USING (author_id = auth.uid()::text);

-- ── community_groups ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can read groups"       ON public.community_groups;
DROP POLICY IF EXISTS "community_groups_select"     ON public.community_groups;

CREATE POLICY "Anyone can read community groups"
    ON public.community_groups
    FOR SELECT
    USING (true);

-- ── community_thread_likes ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own likes"      ON public.community_thread_likes;
DROP POLICY IF EXISTS "community_thread_likes_select" ON public.community_thread_likes;

CREATE POLICY "Authenticated users can read likes"
    ON public.community_thread_likes
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "community_thread_likes_insert" ON public.community_thread_likes;

CREATE POLICY "Authenticated users can like"
    ON public.community_thread_likes
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()::text);

DROP POLICY IF EXISTS "community_thread_likes_delete" ON public.community_thread_likes;

CREATE POLICY "Users can unlike their own likes"
    ON public.community_thread_likes
    FOR DELETE
    USING (user_id = auth.uid()::text);

-- ── community_group_members ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own memberships"   ON public.community_group_members;
DROP POLICY IF EXISTS "community_group_members_select" ON public.community_group_members;

CREATE POLICY "Authenticated users can read memberships"
    ON public.community_group_members
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "community_group_members_insert" ON public.community_group_members;

CREATE POLICY "Users can join groups"
    ON public.community_group_members
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid()::text);

DROP POLICY IF EXISTS "community_group_members_delete" ON public.community_group_members;

CREATE POLICY "Users can leave groups"
    ON public.community_group_members
    FOR DELETE
    USING (user_id = auth.uid()::text);
