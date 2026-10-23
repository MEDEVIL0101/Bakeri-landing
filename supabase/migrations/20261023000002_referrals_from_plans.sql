-- Refer a Vendor: commission comes from the referred vendor's Bakeri PLAN
-- payments, not from fees on their orders (Harvey 2026-10-23).
--
-- Why: 20% of a 5% per-order fee = 1% of the referred vendor's sales, so
-- any earnings figure let the referrer work out another business's revenue.
-- A plan payment is a fixed price ($5.99 Starter / $19.99 Pro), so it
-- reveals nothing about sales — and the dashboard now shows totals only.
--
-- Rules now:
--   * 20% of every paid plan invoice from a referred vendor, for the 12-month
--     attribution window (referrals.attribution_expires_at, unchanged).
--   * Free trials and grandfathered free Starter earn nothing (no payment).
--   * 14-day hold before an earning can be paid out (unchanged); the old
--     CAD $100 GMV maturation gate and the $2,000 fee cap are gone.
--   * A refunded plan invoice reverses its earning (clawed back from the
--     next payout if already paid — same ledger mechanics as before).
--   * Monthly payout on the 1st via release-referral-payouts (unchanged).
--
-- Accrual is called by stripe-billing-webhook on invoice.paid; reversal on
-- charge.refunded. The order-based triggers are dropped. The program never
-- shipped in an app build, so there are no order-based earnings to migrate.

DROP TRIGGER IF EXISTS trg_accrue_referral_earning_ins ON public.orders;
DROP TRIGGER IF EXISTS trg_accrue_referral_earning_upd ON public.orders;
DROP TRIGGER IF EXISTS trg_reverse_referral_earning ON public.orders;

-- Earnings now come from a Stripe invoice; order_id stays for history.
ALTER TABLE public.referral_earnings ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.referral_earnings ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT UNIQUE;
COMMENT ON COLUMN public.referral_earnings.gross_fee_cents IS
  'Plan payment the commission was taken from (invoice amount paid); orders.platform_fee_cents for pre-2026-10-23 order earnings.';

-- ── Accrual (service role: stripe-billing-webhook) ──────────────────────────
CREATE OR REPLACE FUNCTION public.accrue_referral_plan_earning(
    p_referred_baker_id UUID,
    p_invoice_id        TEXT,
    p_amount_cents      INTEGER,
    p_currency          TEXT DEFAULT 'cad'
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

    v_commission := ROUND(p_amount_cents * 0.20);
    IF v_commission <= 0 THEN
        RETURN;
    END IF;

    INSERT INTO public.referral_earnings
        (referral_id, stripe_invoice_id, gross_fee_cents, commission_cents, currency, payable_after)
    VALUES
        (v_ref.id, p_invoice_id, p_amount_cents, v_commission, lower(COALESCE(p_currency, 'cad')), now() + INTERVAL '14 days')
    ON CONFLICT (stripe_invoice_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_referral_plan_earning(p_invoice_id TEXT, p_reason TEXT DEFAULT 'refunded')
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.referral_earnings
    SET reversed_at = now(), reversal_reason = p_reason
    WHERE stripe_invoice_id = p_invoice_id AND reversed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.accrue_referral_plan_earning(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_referral_plan_earning(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_referral_plan_earning(UUID, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_referral_plan_earning(TEXT, TEXT) TO service_role;

-- ── Dashboard: totals only ──────────────────────────────────────────────────
-- Same keys as before so the apps keep working, minus each referred
-- vendor's lifetime_commission_cents. selling_count now means "has paid for
-- a plan" (paying_count is the clearer alias).
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
    v_code         TEXT;
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

    SELECT (stripe_connect_onboarding_complete IS TRUE AND stripe_connect_account_id IS NOT NULL)
      INTO v_eligible
    FROM public.profiles WHERE id = v_uid;

    SELECT code INTO v_code FROM public.referral_codes WHERE user_id = v_uid AND disabled_at IS NULL;

    -- Who they referred and when — never a per-vendor money figure.
    SELECT COALESCE(jsonb_agg(x ORDER BY x.joined_at DESC), '[]'::jsonb) INTO v_referred
    FROM (
        SELECT
            COALESCE(NULLIF(TRIM(p.business_name), ''), NULLIF(TRIM(p.user_name), ''), 'New vendor') AS name,
            r.created_at AS joined_at,
            r.status
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
      INTO v_referred_cnt, v_paying_cnt
    FROM public.referrals r
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
        'eligible',         COALESCE(v_eligible, false),
        'code',             v_code,
        'currency',         'cad',
        'referred_count',   COALESCE(v_referred_cnt, 0),
        'selling_count',    COALESCE(v_paying_cnt, 0),
        'paying_count',     COALESCE(v_paying_cnt, 0),
        'pending_cents',    v_pending,
        'available_cents',  v_available,
        'paid_cents',       v_paid,
        'next_payout_date', (date_trunc('month', now()) + INTERVAL '1 month')::date,
        'referred_bakers',  v_referred
    );
END;
$$;

-- ── Monthly batch: the 14-day hold is the only maturation rule now ──────────
CREATE OR REPLACE FUNCTION public.referral_payout_batches()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH payable AS (  -- matured, unpaid, unreversed
        SELECT e.id, r.referrer_user_id, e.commission_cents
        FROM public.referral_earnings e
        JOIN public.referrals r ON r.id = e.referral_id
        WHERE e.reversed_at IS NULL
          AND e.payout_id IS NULL
          AND e.payable_after <= now()
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
