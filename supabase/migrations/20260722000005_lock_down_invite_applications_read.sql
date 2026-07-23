-- invite_applications had "Authenticated users can read invite applications"
-- (USING (true), role authenticated) -- meaning any signed-in user of the
-- main app (every baker AND every buyer, since it's one shared auth
-- system, not just admins) could read every prospective vendor's
-- application (name, email, phone, business details). There's no is_admin
-- concept anywhere in this schema (profiles has no such column), so this
-- wasn't an intentional admin gate -- authenticated was almost certainly
-- meant as a rough "not the general public" stand-in.
--
-- The only real admin surface, Bakeri Admin (a separate macOS app), reads
-- exclusively via the service_role key (SupabaseAdminService.swift:5),
-- which bypasses RLS entirely -- so this policy was never actually needed
-- for admin functionality. Dropping it removes the exposure with zero
-- functional impact; the table already has its INSERT-for-anon policy
-- (the application submission form) untouched.

DROP POLICY IF EXISTS "Authenticated users can read invite applications" ON public.invite_applications;
