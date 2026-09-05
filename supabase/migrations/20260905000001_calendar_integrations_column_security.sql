-- Fix calendar_integrations token exposure.
-- The "calendar_integrations_select_own" row policy from 20260806000004 grants
-- access to every column on a matching row once RLS passes, including
-- access_token and refresh_token — contradicting that migration's own comment
-- that those columns are "server-only". Any authenticated user could pull
-- their own Google OAuth token straight out of PostgREST. Same bug class,
-- same fix, as pos_integrations (20260713000002_pos_integrations_column_security.sql).
-- Restrict SELECT to the non-token columns actually used by the client
-- (GoogleCalendarService.swift only ever selects these); the token columns
-- remain readable only by the service role (used by the edge functions).

revoke select on calendar_integrations from authenticated;

grant select (
    id, user_id, provider, calendar_id, account_email, is_active, created_at, updated_at
) on calendar_integrations to authenticated;
