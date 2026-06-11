-- Directory claims: lets a business owner associate their Bakerly account
-- with a licensed bakery entry from the open-data directory.
-- Status flow: pending → verified (by admin) | rejected.
-- One active claim per listing (UNIQUE on licensed_bakery_id).

CREATE TABLE IF NOT EXISTS public.directory_claims (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  licensed_bakery_id   TEXT        NOT NULL UNIQUE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.directory_claims ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read claims (needed to show "On Bakerly" badge).
CREATE POLICY "claims_select"
ON public.directory_claims FOR SELECT
USING (true);

-- Authenticated user can submit a claim for themselves.
CREATE POLICY "claims_insert"
ON public.directory_claims FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Owner can update their own claim only while it is still pending.
CREATE POLICY "claims_update"
ON public.directory_claims FOR UPDATE
USING  (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id);
