-- Record web sign-up referrals (Harvey 2026-11-02). Web sign-up keeps the
-- referral code in user_metadata.referral_code, but nothing ever called
-- attribute_referral() for it — and it can't run at sign-up anyway, because
-- referrals.referred_baker_id needs the vendor's profile, which is made later
-- (web "Welcome to Bakeri" or the iPhone setup). So: when a vendor creates
-- their own profile, attribute the code from their sign-up. Same rules as
-- attribute_referral() (it's what runs); never blocks the profile insert.
CREATE OR REPLACE FUNCTION public.attribute_signup_referral()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
BEGIN
    -- Only the vendor creating their own profile (auth.uid() is who
    -- attribute_referral() credits).
    IF auth.uid() IS DISTINCT FROM NEW.id THEN
        RETURN NEW;
    END IF;
    SELECT NULLIF(TRIM(raw_user_meta_data->>'referral_code'), '') INTO v_code
    FROM auth.users WHERE id = NEW.id;
    IF v_code IS NOT NULL THEN
        BEGIN
            PERFORM public.attribute_referral(v_code);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_attribute_signup_referral ON public.profiles;
CREATE TRIGGER profiles_attribute_signup_referral
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.attribute_signup_referral();
