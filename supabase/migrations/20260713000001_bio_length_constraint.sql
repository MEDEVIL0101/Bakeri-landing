-- Client already caps bio input at 200 characters (EditDiscoveryProfileView) —
-- this is a server-side backstop so it can't be bypassed via a direct API call.
-- Existing rows longer than 200 chars are truncated first so the constraint
-- can actually be added.

UPDATE public.profiles
SET bio = LEFT(bio, 200)
WHERE bio IS NOT NULL AND LENGTH(bio) > 200;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_bio_length_check CHECK (bio IS NULL OR LENGTH(bio) <= 200);
