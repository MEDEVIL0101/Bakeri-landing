-- 20260729000003 replaced assign_profile_slug() to stop it from ever touching
-- an already-assigned profile_slug (fixes silent slug rewrites on business_name
-- edits). In doing so it dropped the `is_reserved_slug` skip that
-- 20260714000004_reserved_slugs.sql added to the candidate-generation loop --
-- a regression: a new baker whose business_name slugifies to a reserved word
-- ('shop', 'checkout', 'admin', ...) would get a candidate the CHECK
-- constraint (profiles_profile_slug_not_reserved) then rejects outright,
-- breaking their profile save. Restoring the reserved-word skip here while
-- keeping the "only ever auto-assign once" behavior from 20260729000003.

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
    -- Already has a slug (auto-assigned or manually chosen) -- never touch it
    -- again automatically. A deliberate change goes through saveProfileSlug,
    -- which sets profile_slug_is_custom = true and writes profile_slug directly;
    -- this function just leaves that value alone.
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
    ) OR public.is_reserved_slug(candidate) LOOP
        candidate := base || '-' || suffix;
        suffix    := suffix + 1;
    END LOOP;

    NEW.profile_slug := candidate;
    RETURN NEW;
END;
$$;
