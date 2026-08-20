-- Add post_type column to community_threads
-- Distinguishes text threads from image-first posts

ALTER TABLE community_threads
ADD COLUMN IF NOT EXISTS post_type TEXT NOT NULL DEFAULT 'thread'
    CHECK (post_type IN ('thread', 'image_post'));

-- Back-fill existing rows
UPDATE community_threads SET post_type = 'thread' WHERE post_type IS NULL;

-- Index for feed filtering by post type
CREATE INDEX IF NOT EXISTS idx_community_threads_post_type
    ON community_threads (post_type);
