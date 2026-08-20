-- ============================================================
-- Bakeri Admin Panel — Migration
-- Adds admin-managed columns to the feedback table so the
-- admin panel can track ticket status, assignment, and notes.
-- Safe to run multiple times (uses IF NOT EXISTS guards).
-- ============================================================

-- Add admin workflow columns to the feedback table
ALTER TABLE public.feedback
    ADD COLUMN IF NOT EXISTS admin_status  TEXT    NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS assigned_to   TEXT,
    ADD COLUMN IF NOT EXISTS admin_notes   JSONB   NOT NULL DEFAULT '[]'::jsonb;

-- Constrain admin_status to valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'feedback_admin_status_check'
    ) THEN
        ALTER TABLE public.feedback
            ADD CONSTRAINT feedback_admin_status_check
            CHECK (admin_status IN ('open', 'in_progress', 'escalated', 'resolved', 'archived'));
    END IF;
END $$;

-- Index for efficient queue queries
CREATE INDEX IF NOT EXISTS feedback_admin_status_idx ON public.feedback (admin_status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_assigned_to_idx  ON public.feedback (assigned_to) WHERE assigned_to IS NOT NULL;

-- Service role can SELECT/UPDATE/DELETE all feedback rows (admin panel bypasses RLS with service_role key)
-- No additional RLS policies needed — the service_role key bypasses RLS entirely.

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'feedback'
  AND column_name IN ('admin_status', 'assigned_to', 'admin_notes')
ORDER BY column_name;
