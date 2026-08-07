-- Two bugs found together, both in the "buyer opens an invoice link inside
-- the Bakeri app" path (vs. the guest web path at /pay/, which already
-- respects quoted_price as of this morning's fix):
--
-- 1. get_invoice_preview computed 'total' as a flat SUM(order_items), with
--    no quoted_price fallback and no invoice_type (deposit/balance) split —
--    so a custom-order quoted below its listing price showed the listing's
--    raw "from" total in the in-app preview (EnterInvoiceCodeView), and a
--    balance invoice showed the full total instead of just the balance.
--
-- 2. claim_invoice was far worse: it computed v_total the same flat way and
--    then WROTE it back — UPDATE orders SET quoted_price = v_total — even
--    when a real quoted_price already existed. The moment a buyer claimed an
--    invoice in-app, this permanently overwrote the baker's actual quote
--    with the listing's raw price, corrupting every downstream read
--    (baker's own Generate Invoice button, resending the invoice email,
--    financial reports) for that order going forward. Fixed to only fall
--    back to the items total when quoted_price isn't already set — never
--    overwrite an existing quote.
--
-- Both now match create-invoice-payment-intent's effectiveTotal/invoice_type
-- math exactly (deposit invoice = deposit_amount_cents, balance invoice =
-- effectiveTotal - deposit, full = effectiveTotal).

CREATE OR REPLACE FUNCTION public.get_invoice_preview(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_baker_name TEXT;
    v_items JSON;
    v_items_total NUMERIC;
    v_effective_total NUMERIC;
    v_deposit NUMERIC;
    v_total NUMERIC;
BEGIN
    SELECT o.id, o.user_id, o.due_date, o.is_paid, o.buyer_profile_id,
           o.invoice_type, o.deposit_amount_cents, o.deposit_paid_at, o.quoted_price
    INTO v_order
    FROM orders o
    WHERE o.invoice_code = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_order.id IS NULL THEN
        RETURN json_build_object('error', 'not_found');
    END IF;
    IF v_order.is_paid THEN
        RETURN json_build_object('error', 'already_paid');
    END IF;
    IF v_order.buyer_profile_id IS NOT NULL THEN
        RETURN json_build_object('error', 'already_claimed');
    END IF;

    SELECT COALESCE(business_name, user_name, 'Baker') INTO v_baker_name
    FROM profiles WHERE id = v_order.user_id;

    SELECT json_agg(json_build_object('name', custom_name, 'quantity', quantity))
    INTO v_items
    FROM order_items WHERE order_id = v_order.id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(quantity * price_per_unit), 0) INTO v_items_total
    FROM order_items WHERE order_id = v_order.id AND deleted_at IS NULL;

    v_effective_total := CASE WHEN COALESCE(v_order.quoted_price, 0) > 0
        THEN v_order.quoted_price ELSE v_items_total END;
    v_deposit := COALESCE(v_order.deposit_amount_cents, 0) / 100.0;

    v_total := CASE
        WHEN v_order.invoice_type = 'deposit' THEN v_deposit
        WHEN v_order.invoice_type = 'balance' THEN GREATEST(v_effective_total - v_deposit, 0)
        ELSE v_effective_total
    END;

    RETURN json_build_object(
        'order_id',    v_order.id,
        'baker_name',  v_baker_name,
        'due_date',    v_order.due_date,
        'items',       COALESCE(v_items, '[]'::json),
        'total',       v_total
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_invoice(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_is_paid BOOLEAN;
    v_existing_buyer UUID;
    v_existing_quote NUMERIC;
    v_items_total NUMERIC;
    v_effective_total NUMERIC;
    v_handle TEXT;
    v_name TEXT;
    v_display_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    SELECT id, is_paid, buyer_profile_id, quoted_price
    INTO v_order_id, v_is_paid, v_existing_buyer, v_existing_quote
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

    SELECT COALESCE(SUM(quantity * price_per_unit), 0) INTO v_items_total
    FROM order_items WHERE order_id = v_order_id AND deleted_at IS NULL;

    -- Never overwrite a real quote with the listing's raw item total — only
    -- fall back to it when no quote was ever set.
    v_effective_total := CASE WHEN COALESCE(v_existing_quote, 0) > 0
        THEN v_existing_quote ELSE v_items_total END;

    IF v_effective_total <= 0 THEN
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
        order_source        = 'marketplace',
        marketplace_status  = 'quote_provided',
        quoted_price        = v_effective_total,
        updated_at          = now()
    WHERE id = v_order_id;

    RETURN v_order_id;
END;
$$;
