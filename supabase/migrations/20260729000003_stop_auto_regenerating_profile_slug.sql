-- assign_profile_slug (20260601000008_profile_slugs.sql, refined in
-- 20260714000003_profile_slug_custom_flag.sql) regenerates profile_slug from
-- business_name on every UPDATE where profile_slug_is_custom is false. Since
-- every baker currently has profile_slug_is_custom = false (nobody has used
-- "Edit Storefront Link" yet), any business_name edit silently rewrites their
-- public bakeriapp.com/<slug> link -- breaking any URL they've already shared,
-- with no warning. Confirmed in production: a baker edited her business name
-- and her previously-shared storefront link started 404ing.
--
-- The slug should behave like a username: auto-assigned once at creation,
-- stable afterward unless the baker deliberately changes it. Restrict the
-- trigger to only fire when profile_slug is still NULL.

CREATE OR REPLACE FUNCTION public.assign_profile_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    base      TEXT;
    candidate TEXT;
    suffix    INT := 2;
BEGIN
    -- Already has a slug (auto-assigned or custom) -- never touch it again
    -- automatically. A deliberate change goes through saveProfileSlug, which
    -- sets profile_slug_is_custom = true and writes profile_slug directly.
    IF NEW.profile_slug IS NOT NULL THEN
        RETURN NEW;
    END IF;

    base := public.slugify(NEW.business_name);
    IF base = '' THEN base := public.slugify(NEW.user_name); END IF;
    IF base = '' THEN base := 'baker'; END IF;

    candidate := base;
    WHILE EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profile_slug = candidate AND id IS DISTINCT FROM NEW.id
    ) LOOP
        candidate := base || '-' || suffix;
        suffix    := suffix + 1;
    END LOOP;

    NEW.profile_slug := candidate;
    RETURN NEW;
END;
$$;
