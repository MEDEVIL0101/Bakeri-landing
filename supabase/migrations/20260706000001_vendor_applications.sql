-- Vendor applications: public submissions from the "For Bakers" marketing
-- page (bakeriapp.com) where prospective bakers apply to sell on Bakeri.
-- Unauthenticated — anon key inserts directly from the static site, same
-- pattern as the consumer waitlist. Reviewed by hand from the admin panel
-- via the service role; no public read access.
--
-- Because this is a public, unauthenticated insert endpoint, the table
-- enforces everything the client-side form gates so a scripted request
-- can't bypass validation: field lengths, email/phone shape, the fixed
-- bake-type vocabulary, and both attestations being explicitly true.
-- A trigger additionally caps submissions per IP to blunt bot spam
-- (auth.uid()-based rate limiting, used elsewhere, doesn't apply here
-- since there's no authenticated user).

CREATE TABLE IF NOT EXISTS public.vendor_applications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bakery_name       TEXT        NOT NULL CHECK (char_length(bakery_name) BETWEEN 1 AND 120),
  first_name        TEXT        NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 60),
  last_name         TEXT        NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 60),
  email             TEXT        NOT NULL UNIQUE
                                CHECK (char_length(email) <= 254
                                       AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  phone             TEXT        NOT NULL CHECK (phone ~ '^[0-9+()\-.\s]{7,20}$'),
  bake_types        TEXT[]      NOT NULL
                                CHECK (cardinality(bake_types) BETWEEN 1 AND 12
                                       AND bake_types <@ ARRAY[
                                         'Bread',
                                         'Cake',
                                         'Cookies',
                                         'Cupcakes',
                                         'Cake Pops and Cake Treats',
                                         'Decorated Cookies',
                                         'Donuts',
                                         'Macarons',
                                         'Muffins',
                                         'Pastries',
                                         'Wedding Cakes',
                                         'International'
                                       ]::text[]),
  social_url        TEXT        NOT NULL CHECK (char_length(social_url) BETWEEN 1 AND 300),
  attest_self_made  BOOLEAN     NOT NULL CHECK (attest_self_made = true),
  attest_compliant  BOOLEAN     NOT NULL CHECK (attest_compliant = true),
  ip_address        TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'contacted', 'approved', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_applications ENABLE ROW LEVEL SECURITY;

-- Public application form can insert; no select/update/delete for anon/authenticated.
CREATE POLICY "vendor_applications_insert"
ON public.vendor_applications FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- ─── Anti-spam: IP capture + rate limit ──────────────────────────────────────
-- request.headers is set by PostgREST per request. ip_address is always
-- derived server-side here — any value the client sends for it is ignored
-- and overwritten, so it can't be spoofed to dodge the limit.

CREATE OR REPLACE FUNCTION public.enforce_vendor_application_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
  v_ip      text;
  v_recent  int;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
    v_ip := NULLIF(TRIM(COALESCE(
      v_headers->>'cf-connecting-ip',
      v_headers->>'x-real-ip',
      SPLIT_PART(v_headers->>'x-forwarded-for', ',', 1)
    )), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  NEW.ip_address := v_ip;

  IF v_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_recent
    FROM public.vendor_applications
    WHERE ip_address = v_ip
      AND created_at > NOW() - INTERVAL '24 hours';

    IF v_recent >= 3 THEN
      RAISE EXCEPTION 'Too many applications submitted recently. Please try again later.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_application_limits ON public.vendor_applications;
CREATE TRIGGER trg_vendor_application_limits
BEFORE INSERT ON public.vendor_applications
FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_application_limits();
