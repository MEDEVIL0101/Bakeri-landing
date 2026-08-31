-- redeem_promo_code is called from the finalize-guest-* edge functions,
-- which have no existing-order guard — a retry after a network blip past a
-- successful charge would bump a coded promo's redemption count twice.
-- Make it idempotent per PaymentIntent: a dedupe row keyed on
-- (promotion_id, payment_intent_id); the count only moves when that row is
-- newly inserted.

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    promotion_id      UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    payment_intent_id TEXT NOT NULL,
    redeemed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (promotion_id, payment_intent_id)
);

ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
-- Written only by the SECURITY DEFINER function below (service-role edge
-- functions); no direct client access.

CREATE OR REPLACE FUNCTION public.redeem_promo_code(
    p_promotion_id     UUID,
    p_payment_intent_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    IF p_promotion_id IS NULL THEN
        RETURN false;
    END IF;

    -- Dedupe: first finalize for this (promo, PI) wins; a retry no-ops.
    IF p_payment_intent_id IS NOT NULL THEN
        INSERT INTO public.promotion_redemptions (promotion_id, payment_intent_id)
        VALUES (p_promotion_id, p_payment_intent_id)
        ON CONFLICT (promotion_id, payment_intent_id) DO NOTHING;
        IF NOT FOUND THEN
            RETURN false; -- already counted for this payment
        END IF;
    END IF;

    UPDATE public.promotions
    SET code_redemption_count = code_redemption_count + 1,
        updated_at = now()
    WHERE id = p_promotion_id
      AND code IS NOT NULL
      AND deleted_at IS NULL
      AND (code_max_redemptions IS NULL OR code_redemption_count < code_max_redemptions)
    RETURNING true INTO v_ok;

    RETURN COALESCE(v_ok, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_promo_code(UUID, TEXT) TO anon, authenticated;
