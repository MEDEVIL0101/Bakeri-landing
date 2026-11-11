-- Community Growth Partners (Harvey 2026-11-11).
--
-- People who bring vendors to Bakerï without running a shop themselves — a
-- creator's brand manager doing outreach, a community organiser, an
-- educator — plus custom terms for any referrer (Guelph Cakes: 30%).
--
--   growth_partner_applications  public "apply" form → Admin approves / declines
--   growth_partners              an approved partner (auth user, no shop/profile)
--   partner_leads                a partner's outreach list, with claim + dedupe
--   referral_codes.commission_*  per-referrer rate + term (partners AND vendors)
--   referrals.commission_rate    the rate locked in when that vendor signed up
--
-- A partner's code is an ordinary referral code: it works on every sign-up
-- path a vendor's code does, and earnings / payouts run through the same
-- referral_earnings → release-referral-payouts pipeline. Partners have no
-- profiles row (so they never show up as a shop anywhere), so the referral
-- tables' referrer FKs move from profiles to auth.users — same ids.

-- ── Referrer FKs: profiles → auth.users ──────────────────────────────────
ALTER TABLE public.referral_codes   DROP CONSTRAINT IF EXISTS referral_codes_user_id_fkey;
ALTER TABLE public.referral_codes   ADD  CONSTRAINT referral_codes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.referrals        DROP CONSTRAINT IF EXISTS referrals_referrer_user_id_fkey;
ALTER TABLE public.referrals        ADD  CONSTRAINT referrals_referrer_user_id_fkey
    FOREIGN KEY (referrer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.referral_payouts DROP CONSTRAINT IF EXISTS referral_payouts_referrer_user_id_fkey;
ALTER TABLE public.referral_payouts ADD  CONSTRAINT referral_payouts_referrer_user_id_fkey
    FOREIGN KEY (referrer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── Per-referrer terms ───────────────────────────────────────────────────
ALTER TABLE public.referral_codes
    -- NULL = the standard 20%.
    ADD COLUMN IF NOT EXISTS commission_rate   NUMERIC(5,4) CHECK (commission_rate IS NULL OR (commission_rate > 0 AND commission_rate <= 0.9)),
    -- How long each referred vendor earns commission. NULL = for as long as they pay.
    ADD COLUMN IF NOT EXISTS commission_months INT CHECK (commission_months IS NULL OR commission_months BETWEEN 1 AND 120);

ALTER TABLE public.referrals
    -- Locked in at sign-up, so a later change to the referrer's terms never
    -- rewrites what an existing referral earns (admin can opt in to that).
    ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4);

CREATE OR REPLACE FUNCTION public.trg_referral_lock_terms()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rate   NUMERIC;
    v_months INT;
BEGIN
    SELECT commission_rate, commission_months INTO v_rate, v_months
    FROM public.referral_codes WHERE user_id = NEW.referrer_user_id;
    NEW.commission_rate := COALESCE(v_rate, 0.20);
    IF v_months IS NOT NULL THEN
        NEW.attribution_expires_at := COALESCE(NEW.created_at, now()) + make_interval(months => v_months);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS referral_lock_terms ON public.referrals;
CREATE TRIGGER referral_lock_terms
    BEFORE INSERT OR UPDATE OF referrer_user_id ON public.referrals
    FOR EACH ROW EXECUTE FUNCTION public.trg_referral_lock_terms();

-- ── Applications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_partner_applications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    email            TEXT NOT NULL,
    company          TEXT,
    website          TEXT,
    instagram        TEXT,
    tiktok           TEXT,
    country          TEXT,
    city             TEXT,
    -- Who they reach and how they'd introduce Bakerï.
    audience         TEXT,
    plan             TEXT,
    audience_size    TEXT,
    heard_from       TEXT,
    referral_code    TEXT,               -- a vendor's code, if one sent them
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'declined', 'waitlisted')),
    admin_note       TEXT,
    decided_at       TIMESTAMPTZ,
    partner_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS growth_partner_applications_status_idx ON public.growth_partner_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_partner_applications_email_idx ON public.growth_partner_applications (lower(email));
-- Written by the submit-growth-partner-application function, read by Admin
-- (service role). No client access at all.
ALTER TABLE public.growth_partner_applications ENABLE ROW LEVEL SECURITY;

-- ── Partners ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_partners (
    user_id                            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name                               TEXT NOT NULL,
    email                              TEXT NOT NULL,
    company                            TEXT,
    country                            TEXT NOT NULL DEFAULT 'CA',
    status                             TEXT NOT NULL DEFAULT 'active'
                                       CHECK (status IN ('active', 'paused', 'ended')),
    stripe_connect_account_id          TEXT,
    stripe_connect_onboarding_complete BOOLEAN NOT NULL DEFAULT false,
    application_id                     UUID REFERENCES public.growth_partner_applications(id) ON DELETE SET NULL,
    admin_note                         TEXT,
    agreed_guidelines_at               TIMESTAMPTZ,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.growth_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS growth_partners_self_read ON public.growth_partners;
CREATE POLICY growth_partners_self_read ON public.growth_partners
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_active_growth_partner(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.growth_partners WHERE user_id = p_user_id AND status = 'active');
$$;

-- ── Outreach leads ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_leads (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shop_name          TEXT NOT NULL CHECK (btrim(shop_name) <> ''),
    contact_name       TEXT,
    instagram          TEXT,        -- normalised handle, no @
    email              TEXT,        -- lower-case
    website            TEXT,        -- bare domain
    city               TEXT,
    status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'contacted', 'replied', 'interested', 'signed_up', 'not_interested')),
    notes              TEXT NOT NULL DEFAULT '',
    last_contacted_at  TIMESTAMPTZ,
    next_follow_up     DATE,
    converted_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_leads_partner_idx   ON public.partner_leads (partner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS partner_leads_instagram_idx ON public.partner_leads (instagram) WHERE instagram IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_leads_email_idx     ON public.partner_leads (email)     WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_leads_website_idx   ON public.partner_leads (website)   WHERE website IS NOT NULL;
ALTER TABLE public.partner_leads ENABLE ROW LEVEL SECURITY;
-- Partners read and delete their own; every write that could collide with
-- another partner goes through partner_save_lead (claim + dedupe).
DROP POLICY IF EXISTS partner_leads_own_read ON public.partner_leads;
CREATE POLICY partner_leads_own_read ON public.partner_leads
    FOR SELECT TO authenticated USING (partner_user_id = auth.uid());
DROP POLICY IF EXISTS partner_leads_own_delete ON public.partner_leads;
CREATE POLICY partner_leads_own_delete ON public.partner_leads
    FOR DELETE TO authenticated USING (partner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.norm_instagram(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(lower(regexp_replace(regexp_replace(regexp_replace(btrim(COALESCE(p, '')),
        '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@+', ''), '[/?#[:space:]].*$', '')), '');
$$;
CREATE OR REPLACE FUNCTION public.norm_domain(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(lower(regexp_replace(btrim(COALESCE(p, '')), '^(https?://)?(www\.)?([^/:?#]+).*$', '\3')), '');
$$;

-- A claim lasts 90 days from the partner's last touch, and ends early once
-- the shop says no. A shop already on Bakerï can't be claimed.
CREATE OR REPLACE FUNCTION public.partner_save_lead(p_lead JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid    UUID := auth.uid();
    v_id     UUID := NULLIF(p_lead->>'id', '')::uuid;
    v_name   TEXT := btrim(COALESCE(p_lead->>'shop_name', ''));
    v_ig     TEXT := public.norm_instagram(p_lead->>'instagram');
    v_email  TEXT := NULLIF(lower(btrim(COALESCE(p_lead->>'email', ''))), '');
    v_web    TEXT := public.norm_domain(p_lead->>'website');
    v_status TEXT := COALESCE(NULLIF(p_lead->>'status', ''), 'new');
    v_prev   public.partner_leads%ROWTYPE;
    v_row    public.partner_leads%ROWTYPE;
BEGIN
    IF v_uid IS NULL OR NOT public.is_active_growth_partner(v_uid) THEN
        RAISE EXCEPTION 'Only active Growth Partners can save leads' USING ERRCODE = '42501';
    END IF;
    IF v_name = '' THEN
        RETURN jsonb_build_object('status', 'invalid', 'message', 'Add the shop''s name.');
    END IF;
    IF v_id IS NOT NULL THEN
        SELECT * INTO v_prev FROM public.partner_leads WHERE id = v_id AND partner_user_id = v_uid;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('status', 'invalid', 'message', 'That lead no longer exists.');
        END IF;
    END IF;

    -- Already a Bakerï vendor?
    IF v_email IS NOT NULL AND EXISTS (
        SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE lower(u.email) = v_email AND p.business_name IS NOT NULL
    ) AND (v_prev.id IS NULL OR v_prev.email IS DISTINCT FROM v_email) THEN
        RETURN jsonb_build_object('status', 'existing_vendor',
            'message', 'That shop is already on Bakerï — no need to reach out.');
    END IF;

    -- Claimed by another partner?
    IF EXISTS (
        SELECT 1 FROM public.partner_leads l
        WHERE l.partner_user_id <> v_uid
          AND l.status NOT IN ('not_interested')
          AND GREATEST(l.updated_at, COALESCE(l.last_contacted_at, l.updated_at)) > now() - INTERVAL '90 days'
          AND ((v_ig IS NOT NULL AND l.instagram = v_ig)
            OR (v_email IS NOT NULL AND l.email = v_email)
            OR (v_web IS NOT NULL AND l.website = v_web))
    ) THEN
        RETURN jsonb_build_object('status', 'claimed',
            'message', 'Another Growth Partner is already talking to this shop. Claims open up again after 90 days without contact.');
    END IF;

    IF v_status NOT IN ('new', 'contacted', 'replied', 'interested', 'signed_up', 'not_interested') THEN
        v_status := 'new';
    END IF;

    IF v_prev.id IS NULL THEN
        INSERT INTO public.partner_leads
            (partner_user_id, shop_name, contact_name, instagram, email, website, city, status, notes,
             last_contacted_at, next_follow_up)
        VALUES
            (v_uid, v_name, NULLIF(btrim(p_lead->>'contact_name'), ''), v_ig, v_email, v_web,
             NULLIF(btrim(p_lead->>'city'), ''), v_status, COALESCE(p_lead->>'notes', ''),
             CASE WHEN v_status <> 'new' THEN now() END,
             NULLIF(p_lead->>'next_follow_up', '')::date)
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.partner_leads SET
            shop_name = v_name,
            contact_name = NULLIF(btrim(p_lead->>'contact_name'), ''),
            instagram = v_ig, email = v_email, website = v_web,
            city = NULLIF(btrim(p_lead->>'city'), ''),
            status = v_status,
            notes = COALESCE(p_lead->>'notes', ''),
            last_contacted_at = CASE
                WHEN v_status IS DISTINCT FROM v_prev.status AND v_status <> 'new' THEN now()
                WHEN (p_lead->>'touched')::boolean IS TRUE THEN now()
                ELSE last_contacted_at END,
            next_follow_up = NULLIF(p_lead->>'next_follow_up', '')::date,
            updated_at = now()
        WHERE id = v_prev.id
        RETURNING * INTO v_row;
    END IF;

    RETURN jsonb_build_object('status', 'saved', 'lead', to_jsonb(v_row));
END;
$$;

-- A vendor who signs up with a partner's code and matches one of that
-- partner's leads (by email) moves the lead to "Signed up".
CREATE OR REPLACE FUNCTION public.trg_referral_convert_lead()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email TEXT;
BEGIN
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.referred_baker_id;
    IF v_email IS NOT NULL THEN
        UPDATE public.partner_leads
        SET status = 'signed_up', converted_user_id = NEW.referred_baker_id, updated_at = now()
        WHERE partner_user_id = NEW.referrer_user_id AND email = v_email;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS referral_convert_lead ON public.referrals;
CREATE TRIGGER referral_convert_lead
    AFTER INSERT ON public.referrals
    FOR EACH ROW EXECUTE FUNCTION public.trg_referral_convert_lead();

-- ── Referral functions, partner-aware ────────────────────────────────────

-- Vendors earn while on a plan; partners while active.
CREATE OR REPLACE FUNCTION public.referrer_has_active_plan(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
    SELECT public.effective_plan_tier(p_user_id) <> 'none' OR public.is_active_growth_partner(p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    v_row   public.referral_codes%ROWTYPE;
    v_name  TEXT;
BEGIN
    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('status', 'none');
    END IF;

    SELECT * INTO v_row
    FROM public.referral_codes
    WHERE UPPER(code) = UPPER(TRIM(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;
    IF v_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'disabled');
    END IF;

    SELECT COALESCE(NULLIF(TRIM(business_name), ''), NULLIF(TRIM(user_name), ''))
      INTO v_name
    FROM public.profiles WHERE id = v_row.user_id;
    IF v_name IS NULL THEN
        SELECT COALESCE(NULLIF(TRIM(company), ''), NULLIF(TRIM(name), ''))
          INTO v_name
        FROM public.growth_partners WHERE user_id = v_row.user_id;
    END IF;

    RETURN jsonb_build_object(
        'status', 'valid',
        'referrer_user_id', v_row.user_id,
        'referrer_name', COALESCE(v_name, 'A Bakerï baker')
    );
END;
$function$;

-- Plan invoices: the referral's locked-in rate (20% unless set otherwise).
CREATE OR REPLACE FUNCTION public.accrue_referral_plan_earning(p_referred_baker_id uuid, p_invoice_id text, p_amount_cents integer, p_currency text DEFAULT 'usd'::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    v_ref        public.referrals%ROWTYPE;
    v_commission INTEGER;
BEGIN
    IF COALESCE(p_amount_cents, 0) <= 0 OR p_invoice_id IS NULL THEN
        RETURN;
    END IF;

    SELECT r.* INTO v_ref
    FROM public.referrals r
    WHERE r.referred_baker_id = p_referred_baker_id
      AND r.status = 'active'
      AND r.attribution_expires_at > now()
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF NOT public.referrer_has_active_plan(v_ref.referrer_user_id) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.referral_codes
        WHERE user_id = v_ref.referrer_user_id AND disabled_at IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    v_commission := ROUND(p_amount_cents * COALESCE(v_ref.commission_rate, 0.20));
    IF v_commission <= 0 THEN
        RETURN;
    END IF;

    INSERT INTO public.referral_earnings
        (referral_id, stripe_invoice_id, gross_fee_cents, commission_cents, currency, payable_after)
    VALUES
        (v_ref.id, p_invoice_id, p_amount_cents, v_commission, lower(COALESCE(p_currency, 'usd')), now() + INTERVAL '4 days')
    ON CONFLICT (stripe_invoice_id) DO NOTHING;
END;
$function$;

-- Order platform fees: same rate source.
CREATE OR REPLACE FUNCTION public.accrue_referral_earning_for_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    v_ref           public.referrals%ROWTYPE;
    v_accrued_fees  BIGINT;
    v_commission    INTEGER;
BEGIN
    IF COALESCE(NEW.platform_fee_cents, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT r.* INTO v_ref
    FROM public.referrals r
    WHERE r.referred_baker_id = NEW.user_id
      AND r.status = 'active'
      AND r.attribution_expires_at > now()
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- CAD $2,000 lifetime cap on collected platform fees per referred baker.
    SELECT COALESCE(SUM(gross_fee_cents), 0) INTO v_accrued_fees
    FROM public.referral_earnings
    WHERE referral_id = v_ref.id AND reversed_at IS NULL;

    IF v_accrued_fees >= 200000 THEN
        UPDATE public.referrals SET status = 'fee_cap_reached' WHERE id = v_ref.id AND status = 'active';
        RETURN NEW;
    END IF;

    v_commission := ROUND(NEW.platform_fee_cents * COALESCE(v_ref.commission_rate, 0.20));
    IF v_commission <= 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.referral_earnings
        (referral_id, order_id, gross_fee_cents, commission_cents, currency, payable_after)
    VALUES
        (v_ref.id, NEW.id, NEW.platform_fee_cents, v_commission, 'cad', now() + INTERVAL '14 days')
    ON CONFLICT (order_id) DO NOTHING;

    IF v_accrued_fees + NEW.platform_fee_cents >= 200000 THEN
        UPDATE public.referrals SET status = 'fee_cap_reached' WHERE id = v_ref.id AND status = 'active';
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'accrue_referral_earning_for_order failed for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- Payout batches: a vendor is paid to their shop's Stripe account, a
-- partner to their partner payout account.
CREATE OR REPLACE FUNCTION public.referral_payout_batches()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
    WITH payable AS (
        SELECT e.id, r.referrer_user_id, e.commission_cents
        FROM public.referral_earnings e
        JOIN public.referrals r ON r.id = e.referral_id
        WHERE e.reversed_at IS NULL
          AND e.payout_id IS NULL
          AND e.payable_after <= now()
    ),
    clawback AS (
        SELECT e.id, r.referrer_user_id, e.commission_cents
        FROM public.referral_earnings e
        JOIN public.referrals r ON r.id = e.referral_id
        WHERE e.reversed_at IS NOT NULL
          AND e.payout_id IS NOT NULL
          AND e.clawback_payout_id IS NULL
    ),
    per_referrer AS (
        SELECT
            u AS referrer_user_id,
            COALESCE((SELECT SUM(commission_cents) FROM payable  WHERE referrer_user_id = u), 0) AS gross_positive_cents,
            COALESCE((SELECT SUM(commission_cents) FROM clawback WHERE referrer_user_id = u), 0) AS clawback_cents,
            COALESCE((SELECT array_agg(id) FROM payable  WHERE referrer_user_id = u), '{}') AS pay_ids,
            COALESCE((SELECT array_agg(id) FROM clawback WHERE referrer_user_id = u), '{}') AS clawback_ids
        FROM (
            SELECT referrer_user_id AS u FROM payable
            UNION
            SELECT referrer_user_id AS u FROM clawback
        ) s
    ),
    dest AS (
        SELECT pr.*,
            CASE
                WHEN p.stripe_connect_onboarding_complete IS TRUE AND p.stripe_connect_account_id IS NOT NULL
                    THEN p.stripe_connect_account_id
                WHEN gp.stripe_connect_onboarding_complete AND gp.stripe_connect_account_id IS NOT NULL
                    THEN gp.stripe_connect_account_id
            END AS account_id,
            COALESCE(p.country, gp.country) AS country
        FROM per_referrer pr
        LEFT JOIN public.profiles p         ON p.id = pr.referrer_user_id
        LEFT JOIN public.growth_partners gp ON gp.user_id = pr.referrer_user_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'referrer_user_id',     d.referrer_user_id,
            'stripe_account_id',    d.account_id,
            'country',              d.country,
            'gross_positive_cents', d.gross_positive_cents,
            'clawback_cents',       d.clawback_cents,
            'net_cents',            d.gross_positive_cents - d.clawback_cents,
            'pay_earning_ids',      to_jsonb(d.pay_ids),
            'clawback_earning_ids', to_jsonb(d.clawback_ids)
        )
    ), '[]'::jsonb)
    FROM dest d
    WHERE d.gross_positive_cents - d.clawback_cents > 0
      AND d.account_id IS NOT NULL;
$function$;

-- ── Partner-facing RPCs ──────────────────────────────────────────────────

-- Who am I? NULL when the signed-in user isn't a partner (the web app uses
-- this to route between the vendor app and the partner dashboard).
CREATE OR REPLACE FUNCTION public.partner_me()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'user_id', gp.user_id, 'name', gp.name, 'email', gp.email, 'company', gp.company,
        'country', gp.country, 'status', gp.status,
        'payouts_ready', gp.stripe_connect_onboarding_complete AND gp.stripe_connect_account_id IS NOT NULL,
        'has_payout_account', gp.stripe_connect_account_id IS NOT NULL,
        'agreed_guidelines_at', gp.agreed_guidelines_at,
        'code', c.code,
        'commission_rate', COALESCE(c.commission_rate, 0.20),
        'commission_months', c.commission_months,
        'has_shop', EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = gp.user_id AND p.business_name IS NOT NULL),
        'created_at', gp.created_at)
    FROM public.growth_partners gp
    LEFT JOIN public.referral_codes c ON c.user_id = gp.user_id
    WHERE gp.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.partner_agree_guidelines()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.growth_partners SET agreed_guidelines_at = now(), updated_at = now()
    WHERE user_id = auth.uid() AND agreed_guidelines_at IS NULL;
$$;

-- Everything the dashboard shows, in one round trip. p_days bounds the
-- traffic numbers; money and referrals are all-time.
CREATE OR REPLACE FUNCTION public.partner_dashboard(p_days INT DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid    UUID := auth.uid();
    v_code   TEXT;
    v_since  TIMESTAMPTZ := now() - make_interval(days => GREATEST(LEAST(COALESCE(p_days, 30), 730), 1));
    v_out    JSONB;
BEGIN
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.growth_partners WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'Not a Growth Partner' USING ERRCODE = '42501';
    END IF;
    SELECT upper(code) INTO v_code FROM public.referral_codes WHERE user_id = v_uid;

    WITH ev AS (
        SELECT event, visitor, COALESCE(NULLIF(campaign, ''), '(none)') AS campaign, created_at
        FROM public.site_events
        WHERE v_code IS NOT NULL AND ref_code = v_code AND created_at >= v_since
    ),
    refs AS (
        SELECT r.*, COALESCE(NULLIF(TRIM(p.business_name), ''), NULLIF(TRIM(p.user_name), ''), 'New vendor') AS shop,
               p.profile_slug,
               CASE
                   WHEN vp.tier <> 'none' AND vp.status = 'trialing' THEN 'trialing'
                   WHEN vp.tier <> 'none' AND vp.status IN ('active', 'past_due') THEN 'paying'
                   ELSE 'inactive'
               END AS plan_status,
               vp.tier AS plan_tier
        FROM public.referrals r
        LEFT JOIN public.profiles p ON p.id = r.referred_baker_id
        LEFT JOIN public.vendor_plans vp ON vp.user_id = r.referred_baker_id
        WHERE r.referrer_user_id = v_uid
    ),
    earn AS (
        SELECT e.*, r.referred_baker_id
        FROM public.referral_earnings e
        JOIN public.referrals r ON r.id = e.referral_id
        WHERE r.referrer_user_id = v_uid
    )
    SELECT jsonb_build_object(
        'code', v_code,
        'days', p_days,
        'traffic', jsonb_build_object(
            'visitors',      (SELECT count(DISTINCT visitor) FROM ev),
            'page_views',    (SELECT count(*) FROM ev WHERE event = 'page_view'),
            'signup_views',  (SELECT count(DISTINCT visitor) FROM ev WHERE event IN ('signup_view', 'signup_form')),
            'signups',       (SELECT count(DISTINCT visitor) FROM ev WHERE event = 'signup_done'),
            'daily', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('day', d, 'visitors', n) ORDER BY d)
                FROM (SELECT created_at::date d, count(DISTINCT visitor) n FROM ev GROUP BY 1) x), '[]'::jsonb),
            'campaigns', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('campaign', campaign, 'visitors', n, 'signups', s) ORDER BY n DESC)
                FROM (SELECT campaign, count(DISTINCT visitor) n,
                             count(DISTINCT visitor) FILTER (WHERE event = 'signup_done') s
                      FROM ev GROUP BY campaign) x), '[]'::jsonb)
        ),
        'funnel', jsonb_build_object(
            'signed_up',     (SELECT count(*) FROM refs),
            'signed_up_period', (SELECT count(*) FROM refs WHERE created_at >= v_since),
            'trialing',      (SELECT count(*) FROM refs WHERE plan_status = 'trialing'),
            'paying',        (SELECT count(*) FROM refs WHERE plan_status = 'paying'),
            'inactive',      (SELECT count(*) FROM refs WHERE plan_status = 'inactive')
        ),
        'money', jsonb_build_object(
            'currency',  'usd',
            'pending_cents',   (SELECT COALESCE(SUM(commission_cents), 0) FROM earn WHERE reversed_at IS NULL AND payout_id IS NULL AND payable_after > now()),
            'available_cents', (SELECT COALESCE(SUM(commission_cents), 0) FROM earn WHERE reversed_at IS NULL AND payout_id IS NULL AND payable_after <= now()),
            'paid_cents',      (SELECT COALESCE(SUM(amount_cents), 0) FROM public.referral_payouts WHERE referrer_user_id = v_uid AND status = 'paid'),
            'lifetime_cents',  (SELECT COALESCE(SUM(commission_cents), 0) FROM earn WHERE reversed_at IS NULL),
            'period_cents',    (SELECT COALESCE(SUM(commission_cents), 0) FROM earn WHERE reversed_at IS NULL AND accrued_at >= v_since),
            'next_payout_date', (date_trunc('month', now()) + INTERVAL '1 month')::date,
            'minimum_cents', 2000,
            'monthly', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('month', m, 'cents', c) ORDER BY m)
                FROM (SELECT to_char(date_trunc('month', accrued_at), 'YYYY-MM') m, SUM(commission_cents) c
                      FROM earn WHERE reversed_at IS NULL AND accrued_at >= date_trunc('month', now()) - INTERVAL '11 months'
                      GROUP BY 1) x), '[]'::jsonb)
        ),
        'referrals', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'shop', r.shop, 'slug', r.profile_slug, 'joined_at', r.created_at,
                'plan_status', r.plan_status, 'plan_tier', r.plan_tier, 'status', r.status,
                'rate', COALESCE(r.commission_rate, 0.20),
                'earns_until', CASE WHEN r.attribution_expires_at = 'infinity' THEN NULL ELSE r.attribution_expires_at END,
                'earned_cents', (SELECT COALESCE(SUM(commission_cents), 0) FROM earn e WHERE e.referral_id = r.id AND e.reversed_at IS NULL)
            ) ORDER BY r.created_at DESC) FROM refs r), '[]'::jsonb),
        'payouts', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', id, 'amount_cents', amount_cents, 'currency', currency,
                'status', status, 'created_at', created_at, 'failure_reason', failure_reason) ORDER BY created_at DESC)
            FROM public.referral_payouts WHERE referrer_user_id = v_uid), '[]'::jsonb),
        'leads', (SELECT jsonb_build_object(
                'total', count(*),
                'new', count(*) FILTER (WHERE status = 'new'),
                'contacted', count(*) FILTER (WHERE status IN ('contacted', 'replied')),
                'interested', count(*) FILTER (WHERE status = 'interested'),
                'signed_up', count(*) FILTER (WHERE status = 'signed_up'),
                'follow_ups_due', count(*) FILTER (WHERE next_follow_up <= current_date AND status NOT IN ('signed_up', 'not_interested')))
            FROM public.partner_leads WHERE partner_user_id = v_uid)
    ) INTO v_out;
    RETURN v_out;
END;
$$;

-- ── Admin (service role only) ────────────────────────────────────────────

-- Applications, partners and every referrer on custom terms, for the Admin
-- app's Growth Partners screen.
CREATE OR REPLACE FUNCTION public.admin_growth_partners()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'applications', COALESCE((SELECT jsonb_agg(to_jsonb(a) - 'ip_address' ORDER BY a.created_at DESC)
                                  FROM public.growth_partner_applications a), '[]'::jsonb),
        'partners', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', gp.user_id, 'name', gp.name, 'email', gp.email, 'company', gp.company,
                'country', gp.country, 'status', gp.status, 'admin_note', gp.admin_note,
                'payouts_ready', gp.stripe_connect_onboarding_complete,
                'created_at', gp.created_at,
                'last_sign_in_at', u.last_sign_in_at,
                'code', c.code, 'commission_rate', COALESCE(c.commission_rate, 0.20), 'commission_months', c.commission_months,
                'referred', (SELECT count(*) FROM public.referrals r WHERE r.referrer_user_id = gp.user_id),
                'paying', (SELECT count(*) FROM public.referrals r JOIN public.vendor_plans vp ON vp.user_id = r.referred_baker_id
                           WHERE r.referrer_user_id = gp.user_id AND vp.tier <> 'none' AND vp.status IN ('active', 'past_due')),
                'earned_cents', (SELECT COALESCE(SUM(e.commission_cents), 0) FROM public.referral_earnings e
                                 JOIN public.referrals r ON r.id = e.referral_id
                                 WHERE r.referrer_user_id = gp.user_id AND e.reversed_at IS NULL),
                'leads', (SELECT count(*) FROM public.partner_leads l WHERE l.partner_user_id = gp.user_id)
            ) ORDER BY gp.created_at DESC)
            FROM public.growth_partners gp
            LEFT JOIN auth.users u ON u.id = gp.user_id
            LEFT JOIN public.referral_codes c ON c.user_id = gp.user_id), '[]'::jsonb),
        'custom_terms', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id', c.user_id, 'code', c.code,
                'name', COALESCE(NULLIF(TRIM(p.business_name), ''), gp.name, u.email),
                'email', u.email,
                'commission_rate', COALESCE(c.commission_rate, 0.20), 'commission_months', c.commission_months,
                'is_partner', gp.user_id IS NOT NULL) ORDER BY c.code)
            FROM public.referral_codes c
            JOIN auth.users u ON u.id = c.user_id
            LEFT JOIN public.profiles p ON p.id = c.user_id
            LEFT JOIN public.growth_partners gp ON gp.user_id = c.user_id
            WHERE c.commission_rate IS NOT NULL OR c.commission_months IS NOT NULL), '[]'::jsonb)
    );
$$;

-- Set any referrer's rate / term (and optionally their code). With
-- p_apply_existing, referrals they've already made move to the new rate too.
CREATE OR REPLACE FUNCTION public.admin_set_referrer_terms(
    p_user_id UUID, p_rate NUMERIC, p_months INT, p_code TEXT DEFAULT NULL, p_apply_existing BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_code TEXT := NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g')), '');
    v_rate NUMERIC := CASE WHEN p_rate IS NULL OR p_rate = 0.20 THEN NULL ELSE p_rate END;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
        RETURN jsonb_build_object('status', 'no_such_user');
    END IF;
    IF v_code IS NOT NULL AND (length(v_code) < 4 OR length(v_code) > 16) THEN
        RETURN jsonb_build_object('status', 'bad_code', 'message', 'Codes are 4–16 letters or numbers.');
    END IF;
    IF v_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_codes WHERE upper(code) = v_code AND user_id <> p_user_id) THEN
        RETURN jsonb_build_object('status', 'code_taken', 'message', 'That code belongs to someone else.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE user_id = p_user_id) THEN
        IF v_code IS NOT NULL THEN
            INSERT INTO public.referral_codes (user_id, code) VALUES (p_user_id, v_code);
        ELSE
            PERFORM public.make_referral_code(p_user_id);
        END IF;
    ELSIF v_code IS NOT NULL THEN
        UPDATE public.referral_codes SET code = v_code WHERE user_id = p_user_id;
    END IF;

    UPDATE public.referral_codes
    SET commission_rate = v_rate, commission_months = p_months
    WHERE user_id = p_user_id;

    IF p_apply_existing THEN
        UPDATE public.referrals
        SET commission_rate = COALESCE(v_rate, 0.20),
            attribution_expires_at = CASE WHEN p_months IS NULL THEN 'infinity'
                                          ELSE created_at + make_interval(months => p_months) END
        WHERE referrer_user_id = p_user_id;
    END IF;

    RETURN jsonb_build_object('status', 'saved',
        'code', (SELECT code FROM public.referral_codes WHERE user_id = p_user_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_partner_status(p_user_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE public.growth_partners
    SET status = p_status, admin_note = COALESCE(p_note, admin_note), updated_at = now()
    WHERE user_id = p_user_id;
$$;

-- Find a referrer (vendor or partner) by name / email / code, for the
-- "custom terms" picker.
CREATE OR REPLACE FUNCTION public.admin_find_referrers(p_query TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT u.id AS user_id, u.email,
               COALESCE(NULLIF(TRIM(p.business_name), ''), gp.name, NULLIF(TRIM(p.user_name), ''), u.email) AS name,
               c.code, COALESCE(c.commission_rate, 0.20) AS commission_rate, c.commission_months
        FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        LEFT JOIN public.growth_partners gp ON gp.user_id = u.id
        LEFT JOIN public.referral_codes c ON c.user_id = u.id
        WHERE length(btrim(COALESCE(p_query, ''))) >= 2
          AND (p.business_name ILIKE '%' || btrim(p_query) || '%'
            OR p.profile_slug ILIKE '%' || btrim(p_query) || '%'
            OR u.email ILIKE '%' || btrim(p_query) || '%'
            OR gp.name ILIKE '%' || btrim(p_query) || '%'
            OR c.code ILIKE btrim(p_query) || '%')
        ORDER BY p.business_name NULLS LAST
        LIMIT 20
    ) x;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_growth_partners() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_referrer_terms(UUID, NUMERIC, INT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_partner_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_find_referrers(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_active_growth_partner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_dashboard(INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_lead(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_agree_guidelines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_me(), public.partner_dashboard(INT), public.partner_save_lead(JSONB),
    public.partner_agree_guidelines(), public.is_active_growth_partner(UUID) TO authenticated;
