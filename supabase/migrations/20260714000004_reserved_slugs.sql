-- Prerequisite for clean storefront URLs (bakeriapp.com/sweetsouthern instead
-- of bakeriapp.com/baker/?slug=sweetsouthern): a baker must never be able to
-- claim a slug that collides with a real top-level path already served from
-- the site root (baker/, pay/, privacy-policy.html, etc.) or an obvious
-- future one (about, blog, admin, ...). Enforced two ways: a CHECK
-- constraint so it's impossible via any write path, and the auto-generation
-- trigger treats reserved words as "taken" so it just skips past them with
-- the existing -2/-3 suffix logic instead of hitting the constraint.

CREATE OR REPLACE FUNCTION public.is_reserved_slug(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT LOWER(TRIM(candidate)) = ANY (ARRAY[
        -- real top-level folders/pages served today
        'baker', 'pay', 'connect-return', 'connect-refresh', 'assets',
        'privacy-policy', 'terms-of-service', 'accessibility',
        'robots', 'sitemap', 'llms', 'index',
        -- reserved for likely future pages / obvious squats
        'about', 'blog', 'admin', 'api', 'app', 'www', 'support', 'help',
        'contact', 'home', 'shop', 'store', 'search', 'download', 'downloads',
        'login', 'signin', 'signup', 'register', 'account', 'settings',
        'terms', 'privacy', 'legal', 'static', 'cdn', 'b', 'baker', 'bakers',
        'checkout', 'cart', 'order', 'orders', 'invoice', 'invoices'
    ]);
$$;

-- Backfill any existing rows that already collide (must run before the CHECK
-- constraint below, or adding it would fail against those rows).
DO $$
DECLARE
    r         RECORD;
    candidate TEXT;
    suffix    INT;
BEGIN
    FOR r IN SELECT id, profile_slug FROM public.profiles WHERE public.is_reserved_slug(profile_slug) LOOP
        suffix    := 2;
        candidate := r.profile_slug || '-' || suffix;
        WHILE EXISTS (
            SELECT 1 FROM public.profiles WHERE profile_slug = candidate AND id != r.id
        ) OR public.is_reserved_slug(candidate) LOOP
            suffix    := suffix + 1;
            candidate := r.profile_slug || '-' || suffix;
        END LOOP;
        UPDATE public.profiles SET profile_slug = candidate WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_profile_slug_not_reserved;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_profile_slug_not_reserved
    CHECK (profile_slug IS NULL OR NOT public.is_reserved_slug(profile_slug));

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
    ) OR public.is_reserved_slug(candidate) LOOP
        candidate := base || '-' || suffix;
        suffix    := suffix + 1;
    END LOOP;

    NEW.profile_slug := candidate;
    RETURN NEW;
END;
$$;
