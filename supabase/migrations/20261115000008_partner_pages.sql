-- Growth Partner link-in-bio pages get their own table (Harvey 2026-11-15).
-- Partners don't use any vendor functionality, so their page is no longer a
-- vendor profile (profiles.is_partner_page, 20261111000004): it lives in
-- partner_pages, is edited in the partner dashboard's own editor, and renders
-- at bakeriapp.com/<slug> through its own page (link/index.html). Slugs are
-- unique across vendors and partner pages.

CREATE TABLE IF NOT EXISTS public.partner_pages (
    user_id    UUID PRIMARY KEY REFERENCES public.growth_partners(user_id) ON DELETE CASCADE,
    slug       TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$'),
    name       TEXT NOT NULL,
    bio        TEXT,
    links      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{label, url}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_pages FROM anon, authenticated;
DROP POLICY IF EXISTS partner_pages_own ON public.partner_pages;
CREATE POLICY partner_pages_own ON public.partner_pages FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.partner_pages TO authenticated;
GRANT ALL ON public.partner_pages TO service_role;

-- Is this address used by a vendor, a partner page or a reserved path?
CREATE OR REPLACE FUNCTION public.slug_in_use(p_slug TEXT, p_except UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_reserved_slug(p_slug)
      OR EXISTS (SELECT 1 FROM public.profiles WHERE profile_slug = lower(btrim(p_slug)) AND id IS DISTINCT FROM p_except)
      OR EXISTS (SELECT 1 FROM public.partner_pages WHERE slug = lower(btrim(p_slug)) AND user_id IS DISTINCT FROM p_except);
$$;
REVOKE ALL ON FUNCTION public.slug_in_use(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Vendors: auto slugs skip partner pages too, and a chosen slug can't take one.
CREATE OR REPLACE FUNCTION public.assign_profile_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    base      TEXT;
    candidate TEXT;
    suffix    INT := 2;
BEGIN
    -- A slug that's already set (auto or chosen) is never changed here, but it
    -- can't be a partner page's address.
    IF NEW.profile_slug IS NOT NULL THEN
        IF (TG_OP = 'INSERT' OR NEW.profile_slug IS DISTINCT FROM OLD.profile_slug)
           AND EXISTS (SELECT 1 FROM public.partner_pages WHERE slug = NEW.profile_slug) THEN
            RAISE EXCEPTION 'bakeriapp.com/% is taken. Try another.', NEW.profile_slug USING ERRCODE = '23505';
        END IF;
        RETURN NEW;
    END IF;

    base := public.slugify(NEW.business_name);
    IF base = '' THEN base := public.slugify(NEW.user_name); END IF;
    IF base = '' THEN base := 'baker'; END IF;

    candidate := base;
    WHILE public.slug_in_use(candidate, NEW.id) LOOP
        candidate := base || '-' || suffix;
        suffix    := suffix + 1;
    END LOOP;

    NEW.profile_slug := candidate;
    RETURN NEW;
END;
$function$;

-- Creates the partner's page (once) and returns its slug.
CREATE OR REPLACE FUNCTION public.partner_create_link_page(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid  UUID := auth.uid();
    v_gp   public.growth_partners%ROWTYPE;
    v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
    v_existing TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF NOT public.is_active_growth_partner(v_uid) THEN
        RAISE EXCEPTION 'Your partnership isn''t active.' USING ERRCODE = 'P0001';
    END IF;
    SELECT slug INTO v_existing FROM public.partner_pages WHERE user_id = v_uid;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    SELECT * INTO v_gp FROM public.growth_partners WHERE user_id = v_uid;

    IF v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$' THEN
        RAISE EXCEPTION 'Use 3–40 letters, numbers or dashes, starting and ending with a letter or number.' USING ERRCODE = 'P0001';
    END IF;
    IF public.slug_in_use(v_slug) THEN
        RAISE EXCEPTION 'bakeriapp.com/% is taken. Try another.', v_slug USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.partner_pages (user_id, slug, name)
    VALUES (v_uid, v_slug, coalesce(nullif(btrim(v_gp.company), ''), v_gp.name));
    RETURN v_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.partner_create_link_page(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_create_link_page(TEXT) TO authenticated;

-- Saves the partner's page: name, bio and up to 20 links (https only).
CREATE OR REPLACE FUNCTION public.partner_save_link_page(p_name TEXT, p_bio TEXT, p_links JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_links JSONB;
    v_row   public.partner_pages%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
    IF NOT public.is_active_growth_partner(v_uid) THEN
        RAISE EXCEPTION 'Your partnership isn''t active.' USING ERRCODE = 'P0001';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Add a name for your page.' USING ERRCODE = 'P0001'; END IF;
    IF jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 20 THEN
        RAISE EXCEPTION 'Up to 20 links.' USING ERRCODE = 'P0001';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('label', left(btrim(l->>'label'), 80), 'url', btrim(l->>'url'))), '[]'::jsonb)
      INTO v_links
      FROM jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_links) l
               WHERE l->>'label' = '' OR l->>'url' !~* '^https://[^\s]+$') THEN
        RAISE EXCEPTION 'Each link needs a title and an address starting with https://' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.partner_pages
       SET name = left(btrim(p_name), 80), bio = nullif(left(btrim(coalesce(p_bio, '')), 300), ''),
           links = v_links, updated_at = now()
     WHERE user_id = v_uid
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Create your page first.' USING ERRCODE = 'P0001'; END IF;
    RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.partner_save_link_page(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_save_link_page(TEXT, TEXT, JSONB) TO authenticated;

-- The public page: only while the partnership is active, with their code.
CREATE OR REPLACE FUNCTION public.get_partner_page(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('slug', pp.slug, 'name', pp.name, 'bio', pp.bio, 'links', pp.links,
                            'code', c.code, 'updated_at', pp.updated_at)
  FROM public.partner_pages pp
  LEFT JOIN public.referral_codes c ON c.user_id = pp.user_id
  WHERE pp.slug = lower(btrim(p_slug)) AND public.is_active_growth_partner(pp.user_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_partner_page(TEXT) TO anon, authenticated;

-- partner_me: the page comes from partner_pages; has_shop = a real shop.
CREATE OR REPLACE FUNCTION public.partner_me()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'user_id', gp.user_id, 'name', gp.name, 'email', gp.email, 'company', gp.company,
        'country', gp.country, 'status', gp.status,
        'payouts_ready', gp.stripe_connect_onboarding_complete AND gp.stripe_connect_account_id IS NOT NULL,
        'has_payout_account', gp.stripe_connect_account_id IS NOT NULL,
        'agreed_guidelines_at', gp.agreed_guidelines_at,
        'code', c.code,
        'commission_rate', COALESCE(c.commission_rate, 0.20),
        'commission_months', c.commission_months,
        'has_shop', EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = gp.user_id AND coalesce(btrim(p.business_name), '') <> ''),
        'link_page_slug', (SELECT pp.slug FROM public.partner_pages pp WHERE pp.user_id = gp.user_id),
        'created_at', gp.created_at)
    FROM public.growth_partners gp
    LEFT JOIN public.referral_codes c ON c.user_id = gp.user_id
    WHERE gp.user_id = auth.uid();
$function$;

-- Move existing partner pages out of the vendor table: page + its links,
-- then remove the vendor rows they lived in.
INSERT INTO public.partner_pages (user_id, slug, name, bio, links, created_at, updated_at)
SELECT p.id, p.profile_slug, coalesce(nullif(btrim(p.business_name), ''), p.user_name, 'My page'),
       nullif(btrim(coalesce(p.business_slogan, '')), ''),
       coalesce((SELECT jsonb_agg(jsonb_build_object('label', l.label, 'url', l.url) ORDER BY l.sort_order)
                   FROM public.baker_links l WHERE l.user_id = p.id AND l.deleted_at IS NULL AND l.url ~* '^https://'), '[]'::jsonb),
       now(), now()
FROM public.profiles p
JOIN public.growth_partners gp ON gp.user_id = p.id
WHERE p.is_partner_page
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM public.baker_links WHERE user_id IN (SELECT id FROM public.profiles WHERE is_partner_page);
DELETE FROM public.storefront_events WHERE shop_id IN (SELECT id FROM public.profiles WHERE is_partner_page);
DELETE FROM public.profiles WHERE is_partner_page;

-- The is_partner_page column itself is dropped in 20261115000009, once the
-- web app that no longer reads it is live.
