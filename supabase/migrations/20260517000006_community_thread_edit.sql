-- Add edit tracking columns to community_threads
ALTER TABLE community_threads
    ADD COLUMN IF NOT EXISTS is_edited  boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS edited_at  timestamptz;

-- Allow thread authors to update their own threads
CREATE POLICY "Authors can update own threads"
    ON community_threads
    FOR UPDATE
    USING (auth.uid() = author_id)
    WITH CHECK (auth.uid() = author_id);
