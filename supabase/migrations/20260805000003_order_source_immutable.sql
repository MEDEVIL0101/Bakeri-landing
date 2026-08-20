-- order_source is determined once, at order creation, and must never change
-- afterward — a manual order stays manual, a web order stays web, a
-- marketplace order stays marketplace, permanently. claim_invoice and
-- claim_and_pay_invoice violated this: claiming an invoiced manual order
-- in-app flipped order_source to 'marketplace', which silently swapped the
-- baker's rich manual status workflow (Confirmed/Baked/Decorated/Packaged/
-- Delivered) for the coarser marketplace order sheet, and — per the schema's
-- own "NULL for manual orders" constraint on marketplace_status — corrupted
-- the row's type classification outright.
--
-- Both RPCs still attach the buyer (buyer_profile_id/buyer_display_name),
-- record the price, and (claim_and_pay_invoice) mark it paid — they just no
-- longer touch order_source or marketplace_status.

CREATE OR REPLACE FUNCTION public.claim_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_is_paid BOOLEAN;
    v_existing_buyer UUID;
    v_total NUMERIC;
    v_handle TEXT;
    v_name TEXT;
    v_display_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, is_paid, buyer_profile_id INTO v_order_id, v_is_paid, v_existing_buyer
    FROM orders
    WHERE invoice_code = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_is_paid THEN
        RAISE EXCEPTION 'already_paid';
    END IF;
    IF v_existing_buyer IS NOT NULL THEN
        RAISE EXCEPTION 'already_claimed';
    END IF;

    SELECT COALESCE(SUM(quantity * price_per_unit), 0) INTO v_total
    FROM order_items WHERE order_id = v_order_id AND deleted_at IS NULL;

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'no_amount_due';
    END IF;

    SELECT community_handle, user_name INTO v_handle, v_name
    FROM profiles WHERE id = auth.uid();

    v_display_name := CASE
        WHEN v_handle IS NOT NULL AND TRIM(v_handle) != '' THEN '@' || TRIM(v_handle)
        WHEN v_name IS NOT NULL AND TRIM(v_name) != '' THEN TRIM(v_name)
        ELSE 'Bakeri customer'
    END;

    UPDATE orders
    SET buyer_profile_id    = auth.uid(),
        buyer_display_name  = v_display_name,
        quoted_price        = v_total,
        updated_at          = now()
    WHERE id = v_order_id;

    RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_and_pay_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_is_paid BOOLEAN;
    v_existing_buyer UUID;
    v_total NUMERIC;
    v_deposit_cents INT;
    v_deposit NUMERIC;
    v_is_full_payment BOOLEAN;
    v_handle TEXT;
    v_name TEXT;
    v_display_name TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, is_paid, buyer_profile_id, deposit_amount_cents
    INTO v_order_id, v_is_paid, v_existing_buyer, v_deposit_cents
    FROM orders
    WHERE invoice_code = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'not_found';
    END IF;
    IF v_is_paid THEN
        RAISE EXCEPTION 'already_paid';
    END IF;
    IF v_existing_buyer IS NOT NULL THEN
        RAISE EXCEPTION 'already_claimed';
    END IF;

    SELECT COALESCE(SUM(quantity * price_per_unit), 0) INTO v_total
    FROM order_items WHERE order_id = v_order_id AND deleted_at IS NULL;

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'no_amount_due';
    END IF;

    SELECT community_handle, user_name INTO v_handle, v_name
    FROM profiles WHERE id = auth.uid();

    v_display_name := CASE
        WHEN v_handle IS NOT NULL AND TRIM(v_handle) != '' THEN '@' || TRIM(v_handle)
        WHEN v_name IS NOT NULL AND TRIM(v_name) != '' THEN TRIM(v_name)
        ELSE 'Bakeri customer'
    END;

    v_deposit := COALESCE(v_deposit_cents, 0) / 100.0;
    v_is_full_payment := v_deposit <= 0 OR v_deposit >= v_total;

    IF v_is_full_payment THEN
        UPDATE orders
        SET buyer_profile_id    = auth.uid(),
            buyer_display_name  = v_display_name,
            quoted_price        = v_total,
            payment_status      = 'captured',
            is_paid             = true,
            paid_at             = v_now,
            updated_at          = v_now
        WHERE id = v_order_id;
    ELSE
        UPDATE orders
        SET buyer_profile_id    = auth.uid(),
            buyer_display_name  = v_display_name,
            quoted_price        = v_total,
            payment_status      = 'authorized',
            deposit_amount      = v_deposit,
            deposit_paid_at     = v_now,
            deposit_note        = 'Non-refundable deposit',
            updated_at          = v_now
        WHERE id = v_order_id;
    END IF;

    RETURN v_order_id;
END;
$$;

-- Repair rows already corrupted by the old behavior. Signature is precise:
-- order_source only ever becomes 'marketplace' via UPDATE (as opposed to
-- being set at INSERT time by a genuine marketplace-order-creation path) in
-- claim_invoice/claim_and_pay_invoice, and only those two RPCs set
-- buyer_profile_id on a row that also carries an invoice_code — no
-- legitimate marketplace-order-creation path produces that combination.
UPDATE orders
SET order_source = 'manual',
    marketplace_status = NULL,
    completed_at = NULL,
    updated_at = now()
WHERE invoice_code IS NOT NULL
  AND buyer_profile_id IS NOT NULL
  AND order_source = 'marketplace';
