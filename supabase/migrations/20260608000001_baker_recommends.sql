-- Baker Recommends Feature
-- Creates baker_recommends table, adds recommend_count to profiles,
-- adds recommend_baker event type to community_activity_feed,
-- and sets up trigger to maintain recommend_count and create activity entries.

-- 1. Add recommend_count to profiles
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS recommend_count INTEGER NOT NULL DEFAULT 0;

-- 2. Create baker_recommends table
CREATE TABLE IF NOT EXISTS baker_recommends (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommender_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    baker_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (recommender_id, baker_id)
);

-- 3. RLS for baker_recommends
ALTER TABLE baker_recommends ENABLE ROW LEVEL SECURITY;

-- Logged-in users can read any recommend (needed for checking own recommends)
CREATE POLICY "baker_recommends_select"
    ON baker_recommends FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Users can only insert their own recommends (and not self-recommend)
CREATE POLICY "baker_recommends_insert"
    ON baker_recommends FOR INSERT
    WITH CHECK (
        auth.uid() = recommender_id
        AND auth.uid() <> baker_id
    );

-- Users can only delete their own recommends
CREATE POLICY "baker_recommends_delete"
    ON baker_recommends FOR DELETE
    USING (auth.uid() = recommender_id);

-- 4. Trigger to maintain recommend_count on profiles and insert activity feed entry
CREATE OR REPLACE FUNCTION handle_baker_recommend()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment recommend_count
        UPDATE profiles
            SET recommend_count = recommend_count + 1
            WHERE id = NEW.baker_id;

        -- Insert activity feed entry for the baker (recipient)
        INSERT INTO community_activity_feed
            (recipient_id, actor_id, event_type, is_read, created_at)
        VALUES
            (NEW.baker_id, NEW.recommender_id, 'recommend_baker', FALSE, NOW())
        ON CONFLICT DO NOTHING;

    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement recommend_count (floor at 0)
        UPDATE profiles
            SET recommend_count = GREATEST(0, recommend_count - 1)
            WHERE id = OLD.baker_id;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_baker_recommend ON baker_recommends;
CREATE TRIGGER on_baker_recommend
    AFTER INSERT OR DELETE ON baker_recommends
    FOR EACH ROW EXECUTE FUNCTION handle_baker_recommend();

-- 5. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_baker_recommends_recommender ON baker_recommends(recommender_id);
CREATE INDEX IF NOT EXISTS idx_baker_recommends_baker       ON baker_recommends(baker_id);
