-- user_presence: real-time heartbeat from the iOS app, updated every ~30 seconds.
-- "Online" in the admin panel = last_seen_at < 2 minutes ago.

CREATE TABLE IF NOT EXISTS user_presence (
    user_id      UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    platform     TEXT        NOT NULL DEFAULT 'ios'
);

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own row
CREATE POLICY "presence_own_row"
ON user_presence
FOR ALL
TO authenticated
USING  (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
