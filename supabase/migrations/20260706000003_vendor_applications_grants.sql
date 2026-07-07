-- The anon-key insert from the public "For Bakers" form was rejected with
-- "new row violates row-level security policy" even though the INSERT
-- policy is WITH CHECK (true). Root cause: RLS policies only take effect
-- once the role also holds the underlying table-level privilege — tables
-- created via SQL migration (as the postgres role) don't automatically pick
-- up the anon/authenticated grants that Studio-created tables get for free.
-- Grant exactly what the policy already allows: INSERT only, no SELECT
-- (there is intentionally no public read policy on this table).

GRANT INSERT ON public.vendor_applications TO anon, authenticated;
