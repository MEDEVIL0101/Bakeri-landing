-- profile_slug defaults to the bakery name (assign_profile_slug trigger,
-- 20260601000008_profile_slugs.sql) — that's correct and unchanged. But the
-- trigger currently regenerates the slug from business_name on ANY business
-- name edit, with no way to tell "still on the auto-generated default" apart
-- from "baker deliberately customized this in Settings" — so a manual edit
-- (new EditStorefrontSlugSheet) would silently get clobbered the next time
-- the baker tweaks their bakery name for an unrelated reason.
--
-- Adds a flag the app sets on manual save; the trigger then only continues
-- auto-deriving from business_name until that flag is set.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS profile_slug_is_custom BOOLEAN NOT NULL DEFAULT false;

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
    -- Baker has explicitly chosen their own slug — never auto-overwrite it.
    IF NEW.profile_slug_is_custom THEN
        RETURN NEW;
    END IF;

    -- Skip if business_name unchanged and slug already set
    IF NEW.profile_slug IS NOT NULL
       AND (TG_OP = 'UPDATE' AND OLD.business_name IS NOT DISTINCT FROM NEW.business_name)
    THEN
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
