-- Affiliate program — PHASE 1 functions + triggers.
--
-- Split from 20260908000001 (schema) so the accrual/reversal triggers and the
-- client/edge RPCs live in one reviewable place. Everything here is
-- SECURITY DEFINER with a pinned search_path, and the two order triggers wrap
-- their whole body in an exception handler so referral bookkeeping can never
-- abort an order write — see the 2026-07-20 marketplace-notify incident, where
-- a non-DEFINER trigger side effect took down every baker's order updates.

-- ══════════════════════ accrual trigger ══════════════════════
-- Fires when an order's payment_status reaches 'captured' (the point the
-- platform fee is actually collected — capture-payment for pickup/preorder/
-- custom, the instant-capture finalize-* paths for digital/physical). Keys
-- the referral off the order's baker (orders.user_id); no order-creation path
-- needs to know about referrals.
CREATE OR REPLACE FUNCTION public.accrue_referral_earning_for_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ref           public.referrals%ROWTYPE;
    v_accrued_fees  BIGINT;
    v_commission    INTEGER;
BEGIN
    -- Nothing collected on this order -> nothing to share.
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

    v_commission := ROUND(NEW.platform_fee_cents * 0.20);
    IF v_commission <= 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.referral_earnings
        (referral_id, order_id, gross_fee_cents, commission_cents, currency, payable_after)
    VALUES
        (v_ref.id, NEW.id, NEW.platform_fee_cents, v_commission, 'cad', now() + INTERVAL '14 days')
    ON CONFLICT (order_id) DO NOTHING;

    -- Close the window if this earning took the baker past the fee cap.
    IF v_accrued_fees + NEW.platform_fee_cents >= 200000 THEN
        UPDATE public.referrals SET status = 'fee_cap_reached' WHERE id = v_ref.id AND status = 'active';
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'accrue_referral_earning_for_order failed for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Two triggers, one function: a WHEN clause on a combined INSERT-OR-UPDATE
-- trigger can't reference OLD, and the accrual body is idempotent
-- (ON CONFLICT (order_id) DO NOTHING) so the split is harmless.
DROP TRIGGER IF EXISTS trg_accrue_referral_earning_ins ON public.orders;
CREATE TRIGGER trg_accrue_referral_earning_ins
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.payment_status = 'captured')
EXECUTE FUNCTION public.accrue_referral_earning_for_order();

DROP TRIGGER IF EXISTS trg_accrue_referral_earning_upd ON public.orders;
CREATE TRIGGER trg_accrue_referral_earning_upd
AFTER UPDATE ON public.orders
FOR EACH ROW
WHEN (NEW.payment_status = 'captured' AND OLD.payment_status IS DISTINCT FROM 'captured')
EXECUTE FUNCTION public.accrue_referral_earning_for_order();

-- ══════════════════════ reversal trigger ══════════════════════
-- A refunded / cancelled order pulls its earning back. cancel-order and
-- refund-and-notify-guest-order-declined both land on payment_status =
-- 'refunded', so that single transition is the signal. If the earning was
-- already swept into a payout, the clawback is recovered from the referrer's
-- next monthly sweep (referral_payout_batches nets it out).
CREATE OR REPLACE FUNCTION public.reverse_referral_earning_for_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.referral_earnings
    SET reversed_at = now(),
        reversal_reason = CASE
            WHEN NEW.marketplace_status = 'cancelled' THEN 'order_cancelled'
            WHEN NEW.marketplace_status = 'refunded'  THEN 'order_refunded'
            ELSE 'order_' || COALESCE(NEW.marketplace_status, 'refunded')
        END
    WHERE order_id = NEW.id
      AND reversed_at IS NULL;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reverse_referral_earning_for_order failed for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_referral_earning ON public.orders;
CREATE TRIGGER trg_reverse_referral_earning
AFTER UPDATE ON public.orders
FOR EACH ROW
WHEN (NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded')
EXECUTE FUNCTION public.reverse_referral_earning_for_order();

-- ══════════════════════ referrer-facing RPCs ══════════════════════

-- Opt in / fetch the caller's referral code. Enforces eligibility (finished
-- Stripe Connect). Generates a 6-char code from an unambiguous alphabet.
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid      UUID := auth.uid();
    v_eligible BOOLEAN;
    v_code     TEXT;
    v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no I O L 0 1
    v_attempt  INTEGER := 0;
    i          INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    SELECT (stripe_connect_onboarding_complete IS TRUE AND stripe_connect_account_id IS NOT NULL)
      INTO v_eligible
    FROM public.profiles
    WHERE id = v_uid;

    IF v_eligible IS NOT TRUE THEN
        RAISE EXCEPTION 'Finish setting up payments with Stripe to join the referral program'
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
            -- Either this user's row was created concurrently, or the code
            -- collided. Prefer an existing row; otherwise retry a new code.
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

-- Checkout-time / onboarding-time preview of a typed code.
CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

    SELECT COALESCE(NULLIF(TRIM(business_name), ''), NULLIF(TRIM(user_name), ''), 'A Bakerï baker')
      INTO v_name
    FROM public.profiles WHERE id = v_row.user_id;

    RETURN jsonb_build_object(
        'status', 'valid',
        'referrer_user_id', v_row.user_id,
        'referrer_name', v_name
    );
END;
$$;

-- Bind the calling baker to a referrer. Called from app onboarding, before
-- the baker has any completed order:
--   * explicitly, when they type a code into the onboarding field (p_code), and
--   * unconditionally at onboarding completion with NO argument — which falls
--     back to the referral_code captured on the baker's own vendor_applications
--     row (the web "For Bakers" form / ?ref= link, stored by
--     submit-vendor-application). This is what makes the web path real rather
--     than a field that goes nowhere.
-- Idempotent-ish: a second call returns 'already_referred' rather than erroring.
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
    v_ref_eligible BOOLEAN;
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

    -- Attribution is a signup-time act: refuse once the baker has transacted.
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

    SELECT stripe_connect_account_id INTO v_my_acct  FROM public.profiles WHERE id = v_uid;
    SELECT stripe_connect_account_id,
           (stripe_connect_onboarding_complete IS TRUE AND stripe_connect_account_id IS NOT NULL)
      INTO v_ref_acct, v_ref_eligible
    FROM public.profiles WHERE id = v_referrer;

    IF v_ref_eligible IS NOT TRUE THEN
        RETURN jsonb_build_object('status', 'invalid_code');
    END IF;

    -- Self-dealing guard: same Stripe connected account, or same auth email.
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
            (v_referrer, v_uid, UPPER(v_code), v_source, now() + INTERVAL '12 months');
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('status', 'already_referred');
    END;

    RETURN jsonb_build_object('status', 'attributed', 'referrer_name', v_resolved->>'referrer_name');
END;
$$;

-- One-call payload for the app's "Refer a Baker" screen.
CREATE OR REPLACE FUNCTION public.referral_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid           UUID := auth.uid();
    v_eligible      BOOLEAN;
    v_code          TEXT;
    v_referred      JSONB;
    v_referred_cnt  INTEGER;
    v_active_cnt    INTEGER;
    v_pending       BIGINT;
    v_available     BIGINT;
    v_paid          BIGINT;
    v_next_payout   DATE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    SELECT (stripe_connect_onboarding_complete IS TRUE AND stripe_connect_account_id IS NOT NULL)
      INTO v_eligible
    FROM public.profiles WHERE id = v_uid;

    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid AND disabled_at IS NULL;

    -- Note: we intentionally do NOT expose another baker's raw sales volume
    -- to the referrer — only the commission it earned them.
    SELECT COALESCE(jsonb_agg(x ORDER BY x.joined_at DESC), '[]'::jsonb) INTO v_referred
    FROM (
        SELECT
            COALESCE(NULLIF(TRIM(p.business_name), ''), NULLIF(TRIM(p.user_name), ''), 'New baker') AS name,
            r.created_at AS joined_at,
            r.status,
            COALESCE((
                SELECT SUM(e.commission_cents)
                FROM public.referral_earnings e
                WHERE e.referral_id = r.id AND e.reversed_at IS NULL
            ), 0) AS lifetime_commission_cents
        FROM public.referrals r
        JOIN public.profiles p ON p.id = r.referred_baker_id
        WHERE r.referrer_user_id = v_uid
    ) x;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM public.referral_earnings e
            WHERE e.referral_id = r.id AND e.reversed_at IS NULL
        ))
      INTO v_referred_cnt, v_active_cnt
    FROM public.referrals r
    WHERE r.referrer_user_id = v_uid;

    -- Maturation "GMV" gate: expressed in collected platform fees, which is
    -- the same unit as gross_fee_cents and the $2k cap. CAD $100 of completed
    -- sales == CAD $5.00 of platform fee at the 5% rate == 500 cents.
    -- Accrued but not yet payable: still inside the 14-day hold, or the
    -- referred baker hasn't cleared that threshold yet.
    SELECT COALESCE(SUM(e.commission_cents), 0) INTO v_pending
    FROM public.referral_earnings e
    JOIN public.referrals r ON r.id = e.referral_id
    WHERE r.referrer_user_id = v_uid
      AND e.reversed_at IS NULL
      AND e.payout_id IS NULL
      AND (
            e.payable_after > now()
         OR COALESCE((
                SELECT SUM(e2.gross_fee_cents)
                FROM public.referral_earnings e2
                WHERE e2.referral_id = r.id AND e2.reversed_at IS NULL
            ), 0) < 500
      );

    -- Matured and clear to pay on the next sweep.
    SELECT COALESCE(SUM(e.commission_cents), 0) INTO v_available
    FROM public.referral_earnings e
    JOIN public.referrals r ON r.id = e.referral_id
    WHERE r.referrer_user_id = v_uid
      AND e.reversed_at IS NULL
      AND e.payout_id IS NULL
      AND e.payable_after <= now()
      AND COALESCE((
                SELECT SUM(e2.gross_fee_cents)
                FROM public.referral_earnings e2
                WHERE e2.referral_id = r.id AND e2.reversed_at IS NULL
            ), 0) >= 500;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
    FROM public.referral_payouts
    WHERE referrer_user_id = v_uid AND status = 'paid';

    v_next_payout := (date_trunc('month', now()) + INTERVAL '1 month')::date;

    RETURN jsonb_build_object(
        'eligible',           COALESCE(v_eligible, false),
        'code',               v_code,
        'currency',           'cad',
        'referred_count',     COALESCE(v_referred_cnt, 0),
        'selling_count',      COALESCE(v_active_cnt, 0),
        'pending_cents',      v_pending,
        'available_cents',    v_available,
        'paid_cents',         v_paid,
        'next_payout_date',   v_next_payout,
        'referred_bakers',    v_referred
    );
END;
$$;

-- ══════════════════════ payout-sweep RPCs (service role only) ══════════════════════

-- The monthly batch: one entry per referrer with a positive net, listing the
-- exact earning ids to mark paid and the post-payout reversals to claw back.
-- Called by release-referral-payouts (service role). "Matured" = 14-day hold
-- elapsed AND the referred baker has >= CAD $100 completed GMV.
CREATE OR REPLACE FUNCTION public.referral_payout_batches()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Per-referral collected platform fees (same unit as gross_fee_cents and
    -- the $2k cap). The maturation gate: CAD $100 of completed sales == CAD
    -- $5.00 of platform fee at 5% == 500 cents.
    WITH fees AS (
        SELECT referral_id,
               COALESCE(SUM(gross_fee_cents) FILTER (WHERE reversed_at IS NULL), 0) AS fee_cents
        FROM public.referral_earnings
        GROUP BY referral_id
    ),
    payable AS (  -- matured, unpaid, unreversed
        SELECT e.id, r.referrer_user_id, e.commission_cents
        FROM public.referral_earnings e
        JOIN public.referrals r ON r.id = e.referral_id
        JOIN fees ON fees.referral_id = r.id
        WHERE e.reversed_at IS NULL
          AND e.payout_id IS NULL
          AND e.payable_after <= now()
          AND fees.fee_cents >= 500
    ),
    clawback AS (  -- reversed after already being paid, not yet recovered
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
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'referrer_user_id',     pr.referrer_user_id,
            'stripe_account_id',    p.stripe_connect_account_id,
            'country',              p.country,
            'gross_positive_cents', pr.gross_positive_cents,
            'clawback_cents',       pr.clawback_cents,
            'net_cents',            pr.gross_positive_cents - pr.clawback_cents,
            'pay_earning_ids',      to_jsonb(pr.pay_ids),
            'clawback_earning_ids', to_jsonb(pr.clawback_ids)
        )
    ), '[]'::jsonb)
    FROM per_referrer pr
    JOIN public.profiles p ON p.id = pr.referrer_user_id
    WHERE pr.gross_positive_cents - pr.clawback_cents > 0
      AND p.stripe_connect_account_id IS NOT NULL
      AND p.stripe_connect_onboarding_complete IS TRUE;
$$;

-- Atomically record a sweep result and mark the earnings it covered.
CREATE OR REPLACE FUNCTION public.record_referral_payout(
    p_referrer       UUID,
    p_transfer_id    TEXT,
    p_amount_cents   INTEGER,
    p_currency       TEXT,
    p_status         TEXT,
    p_failure_reason TEXT,
    p_pay_ids        UUID[],
    p_clawback_ids   UUID[],
    p_period_start   TIMESTAMPTZ,
    p_period_end     TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payout_id UUID;
BEGIN
    INSERT INTO public.referral_payouts
        (referrer_user_id, transfer_id, amount_cents, currency, period_start, period_end, status, failure_reason)
    VALUES
        (p_referrer, p_transfer_id, GREATEST(p_amount_cents, 0), p_currency, p_period_start, p_period_end, p_status, p_failure_reason)
    RETURNING id INTO v_payout_id;

    IF p_status = 'paid' THEN
        UPDATE public.referral_earnings
        SET payout_id = v_payout_id
        WHERE id = ANY(p_pay_ids) AND payout_id IS NULL;

        UPDATE public.referral_earnings
        SET clawback_payout_id = v_payout_id
        WHERE id = ANY(p_clawback_ids) AND clawback_payout_id IS NULL;
    END IF;

    RETURN v_payout_id;
END;
$$;

-- ══════════════════════ grants ══════════════════════
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.attribute_referral(TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_dashboard()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(TEXT)            TO anon, authenticated;

-- Internal only: the monthly payout edge function connects as service_role.
-- Strip the implicit PUBLIC execute grant, then hand it back to service_role
-- explicitly so a client JWT (anon/authenticated) can never call these.
REVOKE ALL ON FUNCTION public.referral_payout_batches()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_referral_payout(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, UUID[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
                                                                       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_payout_batches()             TO service_role;
GRANT EXECUTE ON FUNCTION public.record_referral_payout(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, UUID[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
                                                                       TO service_role;
