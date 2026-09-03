-- ============================================================
-- Baker Unavailable Dates
-- Lets a baker mark specific calendar days (a weekend, a vacation
-- stretch) as unavailable for new orders. Buyers see these dates
-- muted/blocked in every date picker tied to that baker — the
-- form's own date field, pickup-date pickers, "I need it by", etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS baker_unavailable_dates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS baker_unavailable_dates_user_idx ON baker_unavailable_dates (user_id);

ALTER TABLE baker_unavailable_dates ENABLE ROW LEVEL SECURITY;

-- Baker: full CRUD on their own blocked dates
CREATE POLICY "baker_manage_own_unavailable_dates"
ON baker_unavailable_dates FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Public: read any baker's blocked dates — needed to render calendars in the
-- buyer flow (marketplace order forms) and on the public storefront web page,
-- neither of which authenticate as the baker. No sensitive data here (just
-- which days are blocked), same public-read posture as pickup hours.
CREATE POLICY "public_read_unavailable_dates"
ON baker_unavailable_dates FOR SELECT
USING (true);
