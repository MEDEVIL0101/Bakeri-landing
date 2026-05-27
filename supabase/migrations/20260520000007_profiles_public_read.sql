-- Allow unauthenticated (guest) users to read public profile fields.
-- Previously required auth.uid() IS NOT NULL, so guests saw "Baker" for every
-- post author because the profile lookup returned no rows.

DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;

CREATE POLICY "profiles_public_read"
    ON public.profiles
    FOR SELECT
    USING (true);
