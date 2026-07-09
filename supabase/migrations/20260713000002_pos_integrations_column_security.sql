-- Fix pos_integrations token exposure.
-- The "pos_select_own" row policy from 20260614000003 grants access to every
-- column on a matching row once RLS passes, including access_token and
-- refresh_token — contradicting that migration's own comment that those
-- columns are "server-only". Any authenticated user could pull their own
-- Square access token straight out of PostgREST.
-- Restrict SELECT to the non-token columns; the token columns remain
-- readable only by the service role (used by the edge functions).

revoke select on pos_integrations from authenticated;

grant select (
    id, user_id, pos_type, merchant_id, merchant_name,
    location_id, is_active, created_at, updated_at
) on pos_integrations to authenticated;
