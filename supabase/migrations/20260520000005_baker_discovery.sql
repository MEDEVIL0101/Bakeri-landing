-- ============================================================
-- Baker Discovery: public profile enrichment + follow system
-- ============================================================

-- Enrich profiles for social discovery
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bio              text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS specialty_tags   text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS location         text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS follower_count   int  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS following_count  int  NOT NULL DEFAULT 0;

-- Baker follows
CREATE TABLE IF NOT EXISTS public.baker_follows (
    follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)
);

ALTER TABLE public.baker_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows_select" ON public.baker_follows
    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "follows_insert" ON public.baker_follows
    FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete" ON public.baker_follows
    FOR DELETE USING (auth.uid() = follower_id);

CREATE INDEX IF NOT EXISTS idx_baker_follows_follower  ON public.baker_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_baker_follows_following ON public.baker_follows(following_id);

-- Maintain follower/following counts via trigger
CREATE OR REPLACE FUNCTION fn_baker_follow_counts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.profiles SET follower_count  = follower_count  + 1 WHERE id = NEW.following_id;
        UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.profiles SET follower_count  = GREATEST(follower_count  - 1, 0) WHERE id = OLD.following_id;
        UPDATE public.profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_baker_follow_counts
AFTER INSERT OR DELETE ON public.baker_follows
FOR EACH ROW EXECUTE FUNCTION fn_baker_follow_counts();
