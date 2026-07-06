-- Route vendor_applications writes exclusively through the
-- submit-vendor-application edge function (service_role), instead of a
-- direct anon-key insert from the browser. The function adds checks a
-- CHECK constraint can't express (disposable-email blocklist, MX-record
-- lookup) using the real client IP seen on the browser's first hop, then
-- inserts with that IP already set.
--
-- Revoking the anon/authenticated grant closes the direct-insert path
-- entirely, so those new checks can't be bypassed by calling the REST API
-- directly instead of going through the function.

REVOKE INSERT ON public.vendor_applications FROM anon, authenticated;
DROP POLICY IF EXISTS "vendor_applications_insert" ON public.vendor_applications;

-- Trust an ip_address the function already set (it read the real client IP
-- on the first hop); only fall back to deriving it from request.headers
-- when the caller didn't supply one.
CREATE OR REPLACE FUNCTION public.enforce_vendor_application_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
  v_ip      text;
  v_recent  int;
BEGIN
  IF NEW.ip_address IS NULL THEN
    BEGIN
      v_headers := current_setting('request.headers', true)::jsonb;
      NEW.ip_address := NULLIF(TRIM(COALESCE(
        v_headers->>'cf-connecting-ip',
        v_headers->>'x-real-ip',
        SPLIT_PART(v_headers->>'x-forwarded-for', ',', 1)
      )), '');
    EXCEPTION WHEN OTHERS THEN
      NEW.ip_address := NULL;
    END;
  END IF;

  v_ip := NEW.ip_address;

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
