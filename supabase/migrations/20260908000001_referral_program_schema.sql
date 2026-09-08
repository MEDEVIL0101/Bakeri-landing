-- Affiliate / "Refer a Baker" program — PHASE 1 schema.
--
-- A user who has finished Stripe Connect (a baker, in MVP) gets a referral
-- code/link. When a new baker signs up with that code and starts selling,
-- the referrer earns 20% of the platform service fee Bakeri collects on that
-- baker's orders (~1% of gross sale), paid out monthly via a Stripe transfer
-- from the platform balance to the referrer's connected account.
--
-- How it rides on the existing payment stack (post 2026-07-30 direct charges
-- + 2026-09-01 Standard Connect): create-payment-intent takes
-- application_fee_amount into Bakeri's platform balance on a direct charge;
-- capture-payment / the finalize-* paths stamp orders.platform_fee_cents once
-- the fee is really collected. Accrual here keys off that column via a
-- trigger (20260908000002) — no order-creation path is touched. The monthly
-- payout is a second stripe.transfers.create, structurally identical to how
-- release-baker-payouts pays a baker.
--
-- Locked rules (2026-09-08):
--   * Commission = round(order.platform_fee_cents * 0.20) per referred-baker order.
--   * Eligibility = profiles.stripe_connect_onboarding_complete AND a connect account id.
--   * Attribution set once, ever, per referred baker, at signup (before they
--     have any completed order). Window = 12 months from attribution OR the
--     first CAD $2,000 of collected platform fees on that baker, whichever first.
--   * Each order's earning is held 14 days (refund/dispute tail). It only
--     becomes payable once the referred baker has cleared CAD $100 of
--     completed GMV.
--   * Payout monthly on the 1st: one transfer per referrer for all matured,
--     non-reversed earnings, netted against any post-payout reversal
--     (clawback). Transfer only if the net is positive, else it rolls forward.
--   * Refund / cancel / chargeback reverses the related earning.
--   * Not retroactive.

-- ─────────────────────────────── referral_codes ───────────────────────────────
-- One code per referrer. Row exists only once the user has opted in (first
-- call to get_or_create_referral_code, which enforces eligibility).
CREATE TABLE IF NOT EXISTS public.referral_codes (
    user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ,
    CONSTRAINT referral_codes_code_shape CHECK (code ~ '^[A-Z0-9]{4,16}$')
);

-- Case-insensitive uniqueness — codes are entered by hand off a screenshot or
-- a spoken word, so "abc123" and "ABC123" must be the same code.
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_key
    ON public.referral_codes (UPPER(code));

-- ─────────────────────────────── referrals ───────────────────────────────
-- One attribution per referred baker, immutable once written.
CREATE TABLE IF NOT EXISTS public.referrals (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    referred_baker_id      UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    referral_code          TEXT NOT NULL,              -- snapshot of the code used
    source                 TEXT NOT NULL DEFAULT 'app_onboarding'
                               CHECK (source IN ('app_onboarding', 'web_application', 'admin')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    attribution_expires_at TIMESTAMPTZ NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'expired', 'fee_cap_reached', 'revoked')),
    CONSTRAINT referrals_no_self CHECK (referrer_user_id <> referred_baker_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_user_id);
-- The accrual trigger's hot lookup: active, in-window referral for a baker.
CREATE INDEX IF NOT EXISTS referrals_active_baker_idx
    ON public.referrals (referred_baker_id)
    WHERE status = 'active';

-- ─────────────────────────────── referral_payouts ───────────────────────────────
-- One row per monthly sweep per referrer (created first so referral_earnings
-- can FK its payout_id / clawback_payout_id back to it).
CREATE TABLE IF NOT EXISTS public.referral_payouts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    transfer_id       TEXT,                            -- Stripe Transfer id; NULL if the transfer failed
    amount_cents      INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency          TEXT NOT NULL DEFAULT 'cad',
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('paid', 'failed')),
    failure_reason    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_payouts_referrer_idx
    ON public.referral_payouts (referrer_user_id, created_at DESC);
-- Idempotency for the monthly cron — one paid sweep per referrer per period.
CREATE UNIQUE INDEX IF NOT EXISTS referral_payouts_one_paid_per_period
    ON public.referral_payouts (referrer_user_id, period_start)
    WHERE status = 'paid';

-- ─────────────────────────────── referral_earnings ───────────────────────────────
-- One row per referred-baker order that carried a platform fee. UNIQUE on
-- order_id makes accrual idempotent.
CREATE TABLE IF NOT EXISTS public.referral_earnings (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id        UUID NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
    order_id           UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    gross_fee_cents    INTEGER NOT NULL CHECK (gross_fee_cents >= 0),   -- orders.platform_fee_cents at accrual
    commission_cents   INTEGER NOT NULL CHECK (commission_cents >= 0),  -- round(gross_fee_cents * 0.20)
    currency           TEXT NOT NULL DEFAULT 'cad',
    accrued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    payable_after      TIMESTAMPTZ NOT NULL,                            -- accrued_at + 14 days
    reversed_at        TIMESTAMPTZ,
    reversal_reason    TEXT,
    payout_id          UUID REFERENCES public.referral_payouts(id) ON DELETE SET NULL,       -- set when swept into a payout
    clawback_payout_id UUID REFERENCES public.referral_payouts(id) ON DELETE SET NULL        -- set when a post-payout reversal is recovered
);

CREATE INDEX IF NOT EXISTS referral_earnings_referral_idx ON public.referral_earnings (referral_id);
-- The monthly sweep's candidate scan: matured, unpaid, unreversed.
CREATE INDEX IF NOT EXISTS referral_earnings_unpaid_idx
    ON public.referral_earnings (payable_after)
    WHERE payout_id IS NULL AND reversed_at IS NULL;
-- Post-payout reversals still owed back.
CREATE INDEX IF NOT EXISTS referral_earnings_clawback_idx
    ON public.referral_earnings (referral_id)
    WHERE reversed_at IS NOT NULL AND payout_id IS NOT NULL AND clawback_payout_id IS NULL;

-- ─────────────────────────────── RLS ───────────────────────────────
-- Same posture as promotions / baker_links: a referrer may read their own
-- rows; every write goes through the SECURITY DEFINER functions in
-- 20260908000002 or the service role (edge functions / cron). No anon access.

ALTER TABLE public.referral_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payouts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referrer_reads_own_code"
    ON public.referral_codes FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "referrer_reads_own_referrals"
    ON public.referrals FOR SELECT
    USING (referrer_user_id = auth.uid());

CREATE POLICY "referrer_reads_own_earnings"
    ON public.referral_earnings FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.referrals r
        WHERE r.id = referral_earnings.referral_id
          AND r.referrer_user_id = auth.uid()
    ));

CREATE POLICY "referrer_reads_own_payouts"
    ON public.referral_payouts FOR SELECT
    USING (referrer_user_id = auth.uid());

-- ─────────────────────── vendor_applications funnel field ───────────────────────
-- The "For Bakers" web form captures a referral code (typed, or carried in a
-- ?ref= link). Stored here for the record and for support/admin attribution;
-- the authoritative attribution still happens in-app once the baker's profile
-- exists (attribute_referral, called from onboarding).
ALTER TABLE public.vendor_applications
    ADD COLUMN IF NOT EXISTS referral_code TEXT
        CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z0-9]{4,16}$');
