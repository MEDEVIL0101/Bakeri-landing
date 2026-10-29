-- Bakeri Referral Program (Refer a Vendor) — Harvey 2026-10-29.
--
-- Builds on 20261023000002_referrals_from_plans (20% of each paid plan
-- invoice from a referred vendor). What changes:
--   * Lifetime, not 12 months: commission recurs for as long as the referred
--     vendor stays subscribed. attribution_expires_at becomes 'infinity'.
--   * You need an active Bakeri plan to refer and to earn. Eligibility to get
--     a code is an active plan (a live subscription, trial included, or
--     grandfathered free Starter) — not Stripe Connect. A referrer whose plan
--     has lapsed earns nothing on invoices paid while it is lapsed, even for
--     referrals that are still paying.
--   * Stripe Connect is only needed to be PAID. Earnings accrue either way and
--     wait in the ledger until the referrer connects Stripe.
--   * 4-day hold on each earning (was 14). Payouts stay monthly on the 1st
--     (20260908000003) rather than a few days after each payment — one
--     transfer per referrer per month keeps Stripe costs down. Everything
--     cleared by the 1st goes out that day.
--   * Paid-ads rule: a disabled code (referral_codes.disabled_at, set by an
--     admin) stops new commission on every referral that referrer has.
--   * Changing referrers: admin_change_referrer, only within 45 days of the
--     referred vendor's signup (14-day trial + 30 days) and only when the
--     referred vendor asks — support checks who is asking; the function
--     enforces the window.
--   * Referred vendors now show their plan state (trialing / paying /
--     inactive) on the dashboard. Still no
--     per-vendor money and no tier.

-- ── Lifetime attribution ────────────────────────────────────────────────────
UPDATE public.referrals
SET attribution_expires_at = 'infinity'
WHERE status = 'active';

-- The 12-month window was the only thing that ever expired a referral.
UPDATE public.referrals
SET status = 'active', attribution_expires_at = 'infinity'
WHERE status = 'expired';

-- ── Who counts as an active member ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.referrer_has_active_plan(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.effective_plan_tier(p_user_id) <> 'none';
$$;

REVOKE ALL ON FUNCTION public.referrer_has_active_plan(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referrer_has_active_plan(UUID) TO service_role;

-- ── Opt in: active plan, not Stripe ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid      UUID := auth.uid();
    v_code     TEXT;
    v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no I O L 0 1
    v_attempt  INTEGER := 0;
    i          INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    IF NOT public.referrer_has_active_plan(v_uid) THEN
        RAISE EXCEPTION 'You need an active Bakeri plan to join the referral program'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;

    LOOP
        v_attempt := v_attempt + 1;
        v_code := '';
        FOR i IN 1..6 LOOP
            v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
        END LOOP;

        BEGIN
            INSERT INTO public.referral_codes (user_id, code) VALUES (v_uid, v_code);
            RETURN v_code;
        EXCEPTION WHEN unique_violation THEN
            SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid;
            IF v_code IS NOT NULL THEN
                RETURN v_code;
            END IF;
            IF v_attempt >= 10 THEN
                RAISE EXCEPTION 'Could not allocate a referral code — please try again';
            END IF;
        END;
    END LOOP;
END;
$$;

-- ── Attribution: lifetime, referrer needs an active plan ────────────────────
CREATE OR REPLACE FUNCTION public.attribute_referral(p_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_my_email     TEXT;
    v_code         TEXT := NULLIF(TRIM(p_code), '');
    v_source       TEXT := 'app_onboarding';
    v_resolved     JSONB;
    v_referrer     UUID;
    v_ref_email    TEXT;
    v_my_acct      TEXT;
    v_ref_acct     TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_baker_id = v_uid) THEN
        RETURN jsonb_build_object('status', 'already_referred');
    END IF;

    -- Attribution is a signup-time act: refuse once the vendor has transacted.
    IF EXISTS (
        SELECT 1 FROM public.orders
        WHERE user_id = v_uid AND marketplace_status IN ('completed', 'delivered')
    ) THEN
        RETURN jsonb_build_object('status', 'too_late');
    END IF;

    SELECT LOWER(email) INTO v_my_email FROM auth.users WHERE id = v_uid;

    -- No explicit code -> fall back to the one entered on the web application.
    IF v_code IS NULL AND v_my_email IS NOT NULL THEN
        SELECT referral_code INTO v_code
        FROM public.vendor_applications
        WHERE LOWER(email) = v_my_email
          AND referral_code IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1;
        IF v_code IS NOT NULL THEN
            v_source := 'web_application';
        END IF;
    END IF;

    IF v_code IS NULL THEN
        RETURN jsonb_build_object('status', 'no_code');
    END IF;

    v_resolved := public.resolve_referral_code(v_code);
    IF v_resolved->>'status' <> 'valid' THEN
        RETURN jsonb_build_object('status', 'invalid_code');
    END IF;
    v_referrer := (v_resolved->>'referrer_user_id')::uuid;

    IF v_referrer = v_uid THEN
        RETURN jsonb_build_object('status', 'self_referral');
    END IF;

    IF NOT public.referrer_has_active_plan(v_referrer) THEN
        RETURN jsonb_build_object('status', 'invalid_code');
    END IF;

    -- Self-dealing guard: same Stripe connected account, or same auth email.
    SELECT stripe_connect_account_id INTO v_my_acct  FROM public.profiles WHERE id = v_uid;
    SELECT stripe_connect_account_id INTO v_ref_acct FROM public.profiles WHERE id = v_referrer;
    IF v_my_acct IS NOT NULL AND v_my_acct = v_ref_acct THEN
        RETURN jsonb_build_object('status', 'self_referral');
    END IF;

    SELECT LOWER(email) INTO v_ref_email FROM auth.users WHERE id = v_referrer;
    IF v_my_email IS NOT NULL AND v_my_email = v_ref_email THEN
        RETURN jsonb_build_object('status', 'self_referral');
    END IF;

    BEGIN
        INSERT INTO public.referrals
            (referrer_user_id, referred_baker_id, referral_code, source, attribution_expires_at)
        VALUES
            (v_referrer, v_uid, UPPER(v_code), v_source, 'infinity');
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('status', 'already_referred');
    END;

    RETURN jsonb_build_object('status', 'attributed', 'referrer_name', v_resolved->>'referrer_name');
END;
$$;

-- ── Accrual: 5-day hold; referrer must be active and not disabled ───────────
CREATE OR REPLACE FUNCTION public.accrue_referral_plan_earning(
    p_referred_baker_id UUID,
    p_invoice_id        TEXT,
    p_amount_cents      INTEGER,
    p_currency          TEXT DEFAULT 'usd'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Referrer cancelled their own plan -> no commission while lapsed.
    IF NOT public.referrer_has_active_plan(v_ref.referrer_user_id) THEN
        RETURN;
    END IF;

    -- Commission turned off (paid ads or other program abuse).
    IF EXISTS (
        SELECT 1 FROM public.referral_codes
        WHERE user_id = v_ref.referrer_user_id AND disabled_at IS NOT NULL
    ) THEN
        RETURN;
    END IF;

    v_commission := ROUND(p_amount_cents * 0.20);
    IF v_commission <= 0 THEN
        RETURN;
    END IF;

    INSERT INTO public.referral_earnings
        (referral_id, stripe_invoice_id, gross_fee_cents, commission_cents, currency, payable_after)
    VALUES
        (v_ref.id, p_invoice_id, p_amount_cents, v_commission, lower(COALESCE(p_currency, 'usd')), now() + INTERVAL '4 days')
    ON CONFLICT (stripe_invoice_id) DO NOTHING;
END;
$$;

-- Earnings already sitting in a 14-day hold come forward to the new 4 days.
UPDATE public.referral_earnings
SET payable_after = LEAST(payable_after, accrued_at + INTERVAL '4 days')
WHERE payout_id IS NULL AND reversed_at IS NULL AND stripe_invoice_id IS NOT NULL;

-- ── Changing referrers (support, on the referred vendor's request) ──────────
-- Rebinds — or first binds, if they forgot the code — a referred vendor to a
-- new referrer. Only within 45 days of the vendor's signup. Unpaid earnings
-- follow the referral to the new referrer; anything already paid out stays
-- with the original referrer.
CREATE OR REPLACE FUNCTION public.admin_change_referrer(
    p_referred_baker_id UUID,
    p_new_code          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_signup   TIMESTAMPTZ;
    v_resolved JSONB;
    v_referrer UUID;
BEGIN
    SELECT created_at INTO v_signup FROM auth.users WHERE id = p_referred_baker_id;
    IF v_signup IS NULL THEN
        RETURN jsonb_build_object('status', 'no_such_vendor');
    END IF;
    IF v_signup < now() - INTERVAL '45 days' THEN
        RETURN jsonb_build_object('status', 'too_late', 'signed_up_at', v_signup);
    END IF;

    v_resolved := public.resolve_referral_code(p_new_code);
    IF v_resolved->>'status' <> 'valid' THEN
        RETURN jsonb_build_object('status', 'invalid_code');
    END IF;
    v_referrer := (v_resolved->>'referrer_user_id')::uuid;

    IF v_referrer = p_referred_baker_id THEN
        RETURN jsonb_build_object('status', 'self_referral');
    END IF;
    IF NOT public.referrer_has_active_plan(v_referrer) THEN
        RETURN jsonb_build_object('status', 'referrer_inactive');
    END IF;

    INSERT INTO public.referrals
        (referrer_user_id, referred_baker_id, referral_code, source, attribution_expires_at)
    VALUES
        (v_referrer, p_referred_baker_id, UPPER(TRIM(p_new_code)), 'admin', 'infinity')
    ON CONFLICT (referred_baker_id) DO UPDATE
        SET referrer_user_id       = EXCLUDED.referrer_user_id,
            referral_code          = EXCLUDED.referral_code,
            source                 = 'admin',
            status                 = 'active',
            attribution_expires_at = 'infinity';

    RETURN jsonb_build_object('status', 'changed', 'referrer_name', v_resolved->>'referrer_name');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_referrer(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_referrer(UUID, TEXT) TO service_role;

-- ── Dashboard ───────────────────────────────────────────────────────────────
-- Same keys as before, plus:
--   eligible       — has an active plan (can share and earn)
--   payouts_ready  — Stripe connected (can be paid)
--   commission_disabled — code turned off by Bakeri
--   referred_bakers[].plan_status — trialing | paying | inactive
CREATE OR REPLACE FUNCTION public.referral_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid          UUID := auth.uid();
    v_eligible     BOOLEAN;
    v_payouts      BOOLEAN;
    v_code         TEXT;
    v_disabled     BOOLEAN;
    v_referred     JSONB;
    v_referred_cnt INTEGER;
    v_paying_cnt   INTEGER;
    v_pending      BIGINT;
    v_available    BIGINT;
    v_paid         BIGINT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    v_eligible := public.referrer_has_active_plan(v_uid);

    SELECT (stripe_connect_onboarding_complete IS TRUE AND stripe_connect_account_id IS NOT NULL)
      INTO v_payouts
    FROM public.profiles WHERE id = v_uid;

    SELECT code, disabled_at IS NOT NULL INTO v_code, v_disabled
    FROM public.referral_codes WHERE user_id = v_uid;
    IF v_disabled THEN
        v_code := NULL;
    END IF;

    SELECT COALESCE(jsonb_agg(x ORDER BY x.joined_at DESC), '[]'::jsonb) INTO v_referred
    FROM (
        SELECT
            COALESCE(NULLIF(TRIM(p.business_name), ''), NULLIF(TRIM(p.user_name), ''), 'New vendor') AS name,
            r.created_at AS joined_at,
            r.status,
            CASE
                WHEN vp.tier <> 'none' AND vp.status = 'trialing' THEN 'trialing'
                WHEN vp.tier <> 'none' AND vp.status IN ('active', 'past_due') THEN 'paying'
                ELSE 'inactive'
            END AS plan_status
        FROM public.referrals r
        JOIN public.profiles p ON p.id = r.referred_baker_id
        LEFT JOIN public.vendor_plans vp ON vp.user_id = r.referred_baker_id
        WHERE r.referrer_user_id = v_uid
    ) x;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE vp.tier <> 'none' AND vp.status IN ('active', 'past_due'))
      INTO v_referred_cnt, v_paying_cnt
    FROM public.referrals r
    LEFT JOIN public.vendor_plans vp ON vp.user_id = r.referred_baker_id
    WHERE r.referrer_user_id = v_uid;

    SELECT
        COALESCE(SUM(e.commission_cents) FILTER (WHERE e.payable_after > now()), 0),
        COALESCE(SUM(e.commission_cents) FILTER (WHERE e.payable_after <= now()), 0)
      INTO v_pending, v_available
    FROM public.referral_earnings e
    JOIN public.referrals r ON r.id = e.referral_id
    WHERE r.referrer_user_id = v_uid
      AND e.reversed_at IS NULL
      AND e.payout_id IS NULL;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
    FROM public.referral_payouts
    WHERE referrer_user_id = v_uid AND status = 'paid';

    RETURN jsonb_build_object(
        'eligible',            COALESCE(v_eligible, false),
        'payouts_ready',       COALESCE(v_payouts, false),
        'commission_disabled', COALESCE(v_disabled, false),
        'code',                v_code,
        'currency',            'usd',
        'referred_count',      COALESCE(v_referred_cnt, 0),
        'selling_count',       COALESCE(v_paying_cnt, 0),
        'paying_count',        COALESCE(v_paying_cnt, 0),
        'pending_cents',       v_pending,
        'available_cents',     v_available,
        'paid_cents',          v_paid,
        'next_payout_date',    (date_trunc('month', now()) + INTERVAL '1 month')::date,
        'referred_bakers',     v_referred
    );
END;
$$;
