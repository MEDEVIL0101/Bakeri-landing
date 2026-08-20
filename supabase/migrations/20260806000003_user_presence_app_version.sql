-- Track which app version each user's device last reported, so the admin
-- panel can show it without needing a new table. Populated by the existing
-- 30s presence heartbeat (see Bakeri/Services/PresenceService.swift) — will
-- read NULL for any user who hasn't sent a heartbeat since this shipped.

ALTER TABLE user_presence ADD COLUMN IF NOT EXISTS app_version TEXT;
