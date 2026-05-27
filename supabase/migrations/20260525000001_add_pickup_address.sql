-- Add pickup location fields to baker profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS pickup_address  TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS pickup_city     TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS pickup_province TEXT NOT NULL DEFAULT '';

-- Allow any authenticated user to read profile rows (needed for buyers to see baker pickup locations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename    = 'profiles'
        AND policyname   = 'Authenticated users can read any profile'
    ) THEN
        CREATE POLICY "Authenticated users can read any profile"
        ON public.profiles FOR SELECT
        TO authenticated
        USING (true);
    END IF;
END $$;
