-- Allow any signed-in user to read other users' profiles.
-- Needed so community features (thread author names, avatars, profile pages) can
-- resolve names for users other than the current user.
-- The existing "Users manage own profile" ALL policy already covers own-row access;
-- PostgreSQL combines multiple policies with OR, so this adds broader read access
-- without loosening write access (INSERT/UPDATE/DELETE still require auth.uid() = id).
CREATE POLICY "Authenticated users can read all profiles"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() IS NOT NULL);
