-- User reports table for in-app content/user moderation.
-- Reporters can insert and view their own submissions; reviews are handled
-- via the service role in the admin panel.

CREATE TABLE IF NOT EXISTS public.user_reports (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_type  TEXT        NOT NULL CHECK (target_type IN ('thread','comment','listing','message','baker')),
    target_id    UUID        NOT NULL,
    reason       TEXT        NOT NULL,
    details      TEXT,
    status       TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','reviewed','dismissed','actioned')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Reporters can submit reports
CREATE POLICY "user_reports_insert"
    ON public.user_reports FOR INSERT TO authenticated
    WITH CHECK (reporter_id = auth.uid());

-- Reporters can view their own submissions
CREATE POLICY "user_reports_select_own"
    ON public.user_reports FOR SELECT TO authenticated
    USING (reporter_id = auth.uid());
