-- Replaces the single free-text social_url field with three optional,
-- platform-specific fields, and adds required city/state_province fields
-- to the "For Bakers" application form. Table has no real submissions yet
-- (test rows were deleted manually after each verification pass), so this
-- drops social_url outright rather than migrating existing data.

ALTER TABLE public.vendor_applications DROP COLUMN IF EXISTS social_url;

ALTER TABLE public.vendor_applications
  ADD COLUMN city           TEXT NOT NULL CHECK (char_length(city) BETWEEN 1 AND 100) DEFAULT '',
  ADD COLUMN state_province TEXT NOT NULL CHECK (char_length(state_province) BETWEEN 1 AND 100) DEFAULT '',
  ADD COLUMN instagram_url  TEXT CHECK (instagram_url IS NULL OR char_length(instagram_url) <= 300),
  ADD COLUMN facebook_url   TEXT CHECK (facebook_url IS NULL OR char_length(facebook_url) <= 300),
  ADD COLUMN tiktok_url     TEXT CHECK (tiktok_url IS NULL OR char_length(tiktok_url) <= 300);

-- Drop the temporary defaults now that the columns exist — new rows must
-- supply real values (defaults were only needed so ADD COLUMN ... NOT NULL
-- succeeds against a table that could in principle already have rows).
ALTER TABLE public.vendor_applications ALTER COLUMN city DROP DEFAULT;
ALTER TABLE public.vendor_applications ALTER COLUMN state_province DROP DEFAULT;
