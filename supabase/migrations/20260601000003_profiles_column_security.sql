-- ==========================================================================
-- profiles: column-level security
--
-- The previous "profiles_public_read" policy used USING(true) with no column
-- restrictions, exposing ALL profile columns to anyone holding the anon key:
--   - email           → private; enables spam/phishing if scraped
--   - pickup_address  → baker's home/premises street address
--   - marketplace_onboarded, baker_type, delivery_gate_accepted,
--     deposits_gate_accepted  → internal business-logic flags
--
-- Fix:
--   1. Drop the broad policy and replace with role-scoped policies.
--   2. Use column-level GRANTs to restrict what each role can SELECT.
--   3. Add a SECURITY DEFINER RPC so ProfileService can read its own
--      full profile row (pickup_address, internal flags) without granting
--      those columns to all authenticated users across all rows.
-- ==========================================================================

-- 1. Drop the current over-permissive policy
DROP POLICY IF EXISTS "profiles_public_read"         ON public.profiles;
DROP POLICY IF EXISTS "profiles_anon_read"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_auth_read"           ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;

-- 2. Role-scoped read policies (row-level: any row is visible;
--    column-level GRANTs below determine what each role actually sees)
CREATE POLICY "profiles_anon_read" ON public.profiles
    FOR SELECT TO anon
    USING (true);

CREATE POLICY "profiles_auth_read" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

-- 3. Anon: safe public-display columns only
--    No email, no street address, no internal flags
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
    id,
    user_name,
    business_name,
    community_handle,
    bio,
    specialty_tags,
    location,
    follower_count,
    following_count,
    updated_at
) ON public.profiles TO anon;

-- 4. Authenticated: public columns + city/province for location display
--    email is intentionally excluded (app reads it from auth.session, not profiles)
--    pickup_address (street) excluded — sensitive; served only via own-profile RPC
--    Internal gate flags excluded — not needed for reading other users' profiles
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
    id,
    user_name,
    business_name,
    community_handle,
    bio,
    specialty_tags,
    location,
    follower_count,
    following_count,
    updated_at,
    pickup_city,
    pickup_province
) ON public.profiles TO authenticated;

-- 5. Security-definer RPC: lets a signed-in user read ALL columns from their
--    OWN profile row only. Used by ProfileService.fetchProfile() so the app
--    can sync pickup_address, internal flags, etc. without exposing those
--    columns across the entire profiles table.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT * FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Only authenticated users may call this; anon cannot
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
