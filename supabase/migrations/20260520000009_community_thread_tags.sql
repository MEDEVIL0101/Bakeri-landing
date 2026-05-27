-- Add tags array to community_threads for tag-based discovery.
-- Replaces the group-picker UX in compose; group_id stays for internal routing.

ALTER TABLE public.community_threads
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_community_threads_tags
    ON public.community_threads USING GIN (tags);
