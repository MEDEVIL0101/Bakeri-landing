-- Bakeri Admin Panel — feedback table admin workflow columns
ALTER TABLE public.feedback
    ADD COLUMN IF NOT EXISTS admin_status  TEXT    NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS assigned_to   TEXT,
    ADD COLUMN IF NOT EXISTS admin_notes   JSONB   NOT NULL DEFAULT '[]'::jsonb;

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

CREATE INDEX IF NOT EXISTS feedback_admin_status_idx ON public.feedback (admin_status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_assigned_to_idx  ON public.feedback (assigned_to) WHERE assigned_to IS NOT NULL;
